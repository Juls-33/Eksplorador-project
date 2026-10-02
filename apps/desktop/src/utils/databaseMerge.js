// Pure merge planner.
// No database writes occur until the entire plan validates.

const key = value => String(value);

const ordered = value =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(name => [name, ordered(value[name])])
        )
      : value;

const canonical = value => JSON.stringify(ordered(value));

const same = (first, second) =>
  canonical(first) === canonical(second);

const originKey = (source, table, id, digest) =>
  JSON.stringify([source, table, key(id), digest]);

async function fingerprint(row) {
  const bytes = new TextEncoder().encode(canonical(row));

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes
  );

  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0')
  ).join('');
}

function dependencyOrder(tables) {
  const pending = new Set(Object.keys(tables));
  const order = [];

  while (pending.size) {
    const next = [...pending].find(name =>
      tables[name].foreign_keys.every(foreignKey =>
        order.includes(foreignKey.table)
      )
    );

    if (!next) {
      throw new Error(
        'Unsupported or missing table relationship. Nothing was merged.'
      );
    }

    order.push(next);
    pending.delete(next);
  }

  return order;
}

export function packageCounts(data) {
  return Object.fromEntries(
    Object.entries(data.tables).map(([name, table]) => [
      name,
      table.rows.length
    ])
  );
}

export async function mergeDatabasePackages(current, packages) {
  const result = structuredClone(current);
  const order = dependencyOrder(result.tables);

  const indexes = new Map();
  const primaryKeys = new Map();
  const nextIds = new Map();
  const origins = new Map();

  result.origins ||= [];

  for (const entry of result.origins) {
    const token = originKey(
      entry.source,
      entry.table,
      entry.id,
      entry.digest
    );

    const list = origins.get(token) || [];
    list.push(entry);
    origins.set(token, list);
  }

  for (const name of order) {
    const table = result.tables[name];

    const primaryKeyColumns = table.columns.filter(
      column => column.primary_key
    );

    if (primaryKeyColumns.length !== 1) {
      throw new Error(
        `Unsupported primary key in ${name}.`
      );
    }

    const primaryKey = primaryKeyColumns[0];

    primaryKeys.set(name, primaryKey);

    indexes.set(
      name,
      new Map(
        table.rows.map(row => [
          key(row[primaryKey.name]),
          row
        ])
      )
    );

    if (/INT/i.test(primaryKey.data_type)) {
      let next = result.sequences[name] || 0;

      for (const row of table.rows) {
        next = Math.max(
          next,
          Number(row[primaryKey.name])
        );
      }

      nextIds.set(name, next);
    }
  }

  let added = 0;
  let skipped = 0;
  let renamed = 0;

  for (const source of packages) {
    if (
      source.format !== current.format ||
      source.version !== current.version ||
      !source.source_id ||
      JSON.stringify(Object.keys(source.tables).sort()) !==
        JSON.stringify([...order].sort())
    ) {
      throw new Error(
        'Every selected file must be a full database backup with the same schema.'
      );
    }

    const mappings = new Map();

    for (const name of order) {
      const table = result.tables[name];
      const incoming = source.tables[name];

      if (
        JSON.stringify(table.columns) !==
          JSON.stringify(incoming.columns) ||
        JSON.stringify(table.foreign_keys) !==
          JSON.stringify(incoming.foreign_keys)
      ) {
        throw new Error(
          `Incompatible schema in ${name}. Nothing was merged.`
        );
      }

      const primaryKey = primaryKeys.get(name);
      const index = indexes.get(name);
      const mapping = new Map();

      mappings.set(name, mapping);

      for (const original of incoming.rows) {
        const originalId = original[primaryKey.name];

        if (mapping.has(key(originalId))) {
          throw new Error(
            `Duplicate ${name} ID in an input file.`
          );
        }

        const row = structuredClone(original);

        for (const foreignKey of table.foreign_keys) {
          const old = row[foreignKey.column];

          if (old === null) {
            continue;
          }

          // Historical descriptive mission labels were never
          // numeric relational IDs.
          if (
            name === 'telemetry' &&
            foreignKey.column === 'mission_id' &&
            typeof old === 'string' &&
            !/^\d+$/.test(old)
          ) {
            continue;
          }

          const target = mappings
            .get(foreignKey.table)
            ?.get(key(old));

          if (target === undefined) {
            throw new Error(
              `Missing ${foreignKey.table} reference in ${name}.`
            );
          }

          row[foreignKey.column] = target;
        }

        const digest = await fingerprint(original);

        const token = originKey(
          source.source_id,
          name,
          originalId,
          digest
        );

        const candidates = [
          ...(origins.get(token) || [])
        ];

        if (source.source_id === result.source_id) {
          candidates.unshift({
            target: originalId
          });
        }

        let existing;

        for (const entry of candidates) {
          const candidate = index.get(
            key(entry.target)
          );

          const expected = {
            ...row,
            [primaryKey.name]:
              candidate?.[primaryKey.name]
          };

          if (
            name === 'crops' &&
            entry.renamedTo &&
            entry.renamedTo === candidate?.name
          ) {
            expected.name = entry.renamedTo;
          }

          if (
            candidate &&
            same(candidate, expected)
          ) {
            existing = candidate;
            break;
          }
        }

        if (existing) {
          mapping.set(
            key(originalId),
            existing[primaryKey.name]
          );

          skipped++;
          continue;
        }

        let id = originalId;

        if (/INT/i.test(primaryKey.data_type)) {
          if (
            !Number.isSafeInteger(Number(id)) ||
            Number(id) < 0
          ) {
            throw new Error(
              `Invalid numeric ID in ${name}.`
            );
          }

          id = Number(id);

          if (index.has(key(id))) {
            id = nextIds.get(name) + 1;
          }

          if (!Number.isSafeInteger(id)) {
            throw new Error(
              `ID range exhausted in ${name}.`
            );
          }

          nextIds.set(
            name,
            Math.max(nextIds.get(name), id)
          );

          result.sequences[name] =
            nextIds.get(name);
        } else {
          let suffix = 2;

          while (index.has(key(id))) {
            id = `${originalId}-M${suffix++}`;
          }
        }

        // The legacy crops table has a UNIQUE name in addition
        // to its ID. Preserve conflicting definitions under
        // a visible distinct name.
        if (name === 'crops') {
          const names = new Set(
            table.rows.map(record => record.name)
          );

          let suffix = 2;

          while (names.has(row.name)) {
            row.name =
              `${original.name} (merged ${suffix++})`;
          }

          if (row.name !== original.name) {
            renamed++;
          }
        }

        row[primaryKey.name] = id;

        table.rows.push(row);
        index.set(key(id), row);
        mapping.set(key(originalId), id);

        const entry = {
          source: source.source_id,
          table: name,
          id: originalId,
          digest,
          target: id,
          ...(
            name === 'crops' &&
            row.name !== original.name
              ? { renamedTo: row.name }
              : {}
          )
        };

        result.origins.push(entry);

        origins.set(token, [
          ...(origins.get(token) || []),
          entry
        ]);

        added++;
      }
    }
  }

  return {
    data: result,
    added,
    skipped,
    renamed
  };
}