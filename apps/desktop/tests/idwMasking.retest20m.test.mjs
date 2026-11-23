// MTP-SW-02 retest. Synthetic fixtures only: no database, telemetry or firmware access.
// From project root: node --test --test-reporter=spec apps/desktop/tests/idwMasking.retest20m.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateIDWHeatmapGrid, evaluateHeatmapPoint, consolidateHeatPoints } from '../src/utils/geo.js';
import { autoHeatmapBoundary } from '../src/utils/heatmapCoverage.js';

const LAT = 14.6, LNG = 121;
const point = (north, east) => [LAT + north/111195, LNG + east/(111195*Math.cos(LAT*Math.PI/180))];
const sample = (north,east,value) => [...point(north,east),value];
const box = (half=40) => [point(-half,-half),point(-half,half),point(half,half),point(half,-half)];
const settings = {power:2,maxInfluenceRadiusM:25,minNeighbors:2,localCoverageRadiusM:20,gridResolution:8,includeCoverage:true};
const close = (actual,expected,tolerance=0.002) => assert.ok(Math.abs(actual-expected)<=tolerance,`expected ${expected}, received ${actual}, tolerance ${tolerance}`);
const at = (n,e,samples,extra={}) => evaluateHeatmapPoint(point(n,e),consolidateHeatPoints(samples),{...settings,...extra});
function grid(samples,polygon=box(),extra={}) {return generateIDWHeatmapGrid(samples,polygon,{...settings,...extra});}
function cellAt(results,n,e) {const p=point(n,e);return results.find(q=>Math.abs(p[0]-q[0])<1e-10&&Math.abs(p[1]-q[1])<1e-10);}
// For these fixtures every source is inside the polygon, so source tails can be excluded.
function generatedOnly(results,samples) {return results.slice(0,-consolidateHeatPoints(samples).length);}
function reference(values,distances,power=2) {const weights=distances.map(d=>1/d**power);return values.reduce((s,v,i)=>s+v*weights[i],0)/weights.reduce((a,b)=>a+b,0);}

const geoUrl=new URL('../src/utils/geo.js',import.meta.url);
const rendererUrl=new URL('../src/components/HeatmapMap.jsx',import.meta.url);
const appUrl=new URL('../src/App.jsx',import.meta.url);
assert.match(readFileSync(appUrl,'utf8'),/import\s+FieldMapView\s+from\s+['"]\.\/views\/FieldMapView(?:\.jsx)?['"]/,'App.jsx must import the reviewed views/FieldMapView');
const fieldUrl=new URL('../src/views/FieldMapView.jsx',import.meta.url);
const helperUrl=new URL('../src/utils/heatmapCoverage.js',import.meta.url);
const renderer=readFileSync(rendererUrl,'utf8');
const field=readFileSync(fieldUrl,'utf8');
console.log(`MTP-SW-02 isolated retest | ${new Date().toISOString()} | ${process.version} | ${process.platform}`);
console.log(`Active Field Map: ${fieldUrl.pathname}`);
console.log('Explicit numerical settings: local=20 m, search=25 m, neighbors=2, power=2');
for(const [label,url] of [['App.jsx',appUrl],['geo.js',geoUrl],['HeatmapMap.jsx',rendererUrl],['FieldMapView.jsx',fieldUrl],['heatmapCoverage.js',helperUrl]]) console.log(`SHA256 ${label}: ${createHash('sha256').update(readFileSync(url)).digest('hex')}`);

for(const value of [20,40,60]) test(`SW02-STEP1: generated cell preserves exact source ${value}%`,()=>{
 const samples=[sample(0,0,value),sample(10,0,80)];
 const cells=generatedOnly(grid(samples),samples),cell=cellAt(cells,0,0);
 assert.ok(cell,'Actual generated source cell missing');close(cell[2],value,0.001);
 console.log(`STEP1 source ${value}% -> ${cell[2].toFixed(4)}%`);
});

test('SW02-STEP2: 20/80 equal-distance generated midpoint equals 50%',()=>{
 const samples=[sample(0,-10,20),sample(0,10,80)];
 const midpoint=cellAt(generatedOnly(grid(samples),samples),0,0);
 assert.ok(midpoint);close(midpoint[2],50,0.001);
 console.log(`STEP2 midpoint=${midpoint[2].toFixed(4)}%`);
});

test('SW02-STEP3A: multi-site power-2 IDW matches independent metric reference',()=>{
 const samples=[sample(10,0,20),sample(-20,0,80),sample(0,15,50)];
 const expected=reference([20,80,50],[10,20,15]);const actual=at(0,0,samples).value;
 close(actual,expected);console.log(`STEP3A expected=${expected.toFixed(6)}, actual=${actual.toFixed(6)}`);
});
test('SW02-STEP3B: power change favors the nearer sample',()=>{
 const samples=[sample(10,0,20),sample(-20,0,80)];
 const p1=at(0,0,samples,{power:1}).value,p2=at(0,0,samples).value;
 close(p1,40);close(p2,32);assert.ok(p2<p1);console.log(`STEP3B power1=${p1.toFixed(4)}, power2=${p2.toFixed(4)}`);
});
test('SW02-STEP3C: duplicate and near-duplicate site average contributes once',()=>{
 const samples=[sample(10,0,20),sample(10,0,40),sample(10.3,0,60),sample(-20,0,80)];
 const sites=consolidateHeatPoints(samples);assert.equal(sites.length,2);close(sites[0][2],40,0.001);
 const actual=at(0,0,samples).value;close(actual,48);console.log(`STEP3C sites=${sites.length}, center=${actual.toFixed(4)}`);
});
test('SW02-STEP3D: duplicate packets cannot satisfy two distinct neighbors',()=>{
 const samples=Array.from({length:15},()=>sample(0,0,40));
 assert.equal(at(0,21,samples),null); // Outside local radius, one physical site only.
});
test('SW02-STEP3E: repeating identical packets does not change the numerical grid',()=>{
 const samples=[sample(0,-10,20),sample(0,10,80)];
 assert.deepEqual(grid(samples),grid([...samples,...Array.from({length:20},()=>samples[0])]));
});

test('SW02-STEP4A: one site paints a generated cell 10 m away',()=>{
 const samples=[sample(0,0,40)],cell=cellAt(generatedOnly(grid(samples),samples),0,10);
 assert.ok(cell);close(cell[2],40);close(cell[3],1);
 console.log(`STEP4A one site at 10 m: value=${cell[2]}, opacity=${cell[3]}`);
});
test('SW02-STEP4B: local estimate fades but keeps its value at 19 m',()=>{
 const result=at(0,19,[sample(0,0,40)]);assert.ok(result);assert.equal(result.kind,'local');
 close(result.value,40);assert.ok(result.opacity>0&&result.opacity<1);
 console.log(`STEP4B 19 m: value=${result.value}, opacity=${result.opacity.toFixed(6)}`);
});
test('SW02-STEP4C: one site cannot paint beyond the 20 m local radius',()=>{
 assert.equal(at(0,20.1,[sample(0,0,40)]),null);
 assert.equal(at(0,21,[sample(0,0,40)]),null);
 assert.equal(cellAt(grid([sample(0,0,40)]),0,30),undefined);
});
test('SW02-STEP4D: two sites can support IDW beyond both local footprints',()=>{
 const result=at(22,0,[sample(0,-10,20),sample(0,10,80)]);
 assert.ok(result);assert.equal(result.kind,'interpolated');close(result.value,50);
 console.log(`STEP4D two neighbors ~24.17 m away: ${result.value.toFixed(4)}%`);
});
test('SW02-STEP4E: points outside search and local radii remain blank',()=>{
 assert.equal(at(0,36,[sample(0,-10,20),sample(0,10,80)]),null);
});
test('SW02-STEP4F: overlapping footprints return a weighted mean, not a sum',()=>{
 const samples=[sample(0,0,20),sample(0,8,80)];const result=at(0,4,samples);
 close(result.value,50);assert.ok(result.opacity<=1);
 for(const cell of grid(samples)) assert.ok(cell[2]>=20-1e-9&&cell[2]<=80+1e-9);
});
test('SW02-STEP4G: rectangular polygon masks output including an outside source',()=>{
 const samples=[sample(0,0,40),sample(30,30,80)];const results=grid(samples,box(20));
 assert.ok(results.length);
 for(const [lat,lng] of results) {
  const n=(lat-LAT)*111195,e=(lng-LNG)*111195*Math.cos(LAT*Math.PI/180);
  assert.ok(Math.abs(n)<=20.001&&Math.abs(e)<=20.001);
 }
 assert.equal(cellAt(results,30,30),undefined);
 console.log(`STEP4G clipped output count=${results.length}; not compared with historical 45`);
});
test('SW02-STEP4H: concave polygon leaves its excluded notch blank',()=>{
 const polygon=[point(-30,-30),point(-30,30),point(0,30),point(0,0),point(30,0),point(30,-30)];
 const results=grid([sample(-10,10,40),sample(10,10,80)],polygon,{gridResolution:12});
 assert.ok(results.length);assert.equal(cellAt(results,10,10),undefined);
 for(const [lat,lng] of results) {
  const n=(lat-LAT)*111195,e=(lng-LNG)*111195*Math.cos(LAT*Math.PI/180);
  assert.ok(!(n>0.001&&e>0.001),'Colored cell in excluded notch');
 }
});
test('SW02-STEP4I: fade changes alpha only, retaining 40% across local footprint',()=>{
 const samples=[sample(0,0,40)],inner=at(0,10,samples),edge=at(0,17,samples);
 close(inner.opacity,1);close(edge.opacity,0.5,0.001);close(inner.value,40);close(edge.value,40);
});
test('SW02-STEP4J: auto canvas extent retains isolated coverage with no saved field',()=>{
 const samples=[sample(0,0,40)],boundary=autoHeatmapBoundary(samples,25);
 assert.equal(boundary.length,4);const results=grid(samples,boundary,{gridResolution:64});
 assert.ok(results.length>100);assert.ok(results.every(p=>p[2]===40));
});
test('SW02-STEP4K: empty or degenerate fixtures return without invalid output',()=>{
 assert.deepEqual(grid([]),[]);assert.deepEqual(grid([[NaN,LNG,20]]),[]);
 assert.deepEqual(grid([sample(0,0,20)],[point(0,0),point(0,0),point(0,0)]),[]);
});

// Execute the uploaded renderer effect without React/Leaflet/browser dependencies.
// Canvas mock uses source-over alpha: missing clearRect would accumulate opacity.
const colorFunction=renderer.slice(renderer.indexOf('function rasterColor('),renderer.indexOf('export default function'));
const effectStart=renderer.indexOf('    if (!mapInstanceRef.current) return;',renderer.indexOf('// Draw an IDW raster'));
const effectEnd=renderer.indexOf('\n  }, [heatPoints, boundary,',effectStart);
assert.ok(effectStart>=0&&effectEnd>effectStart,'Renderer structure changed: review harness before proceeding');
const effectBody=renderer.slice(effectStart,effectEnd);
function render(samples,radius=20) {
 const pixels=new Map();let overlay,options;const calls=[];
 const ctx={globalAlpha:1,fillStyle:'',clearRect(x,y){pixels.delete(`${x},${y}`);},fillRect(x,y){const key=`${x},${y}`,previous=pixels.get(key);const alpha=this.globalAlpha+(previous?.alpha||0)*(1-this.globalAlpha);pixels.set(key,{x,y,alpha,color:this.fillStyle});}};
 const canvas={getContext:()=>ctx,toDataURL:()=> 'data:image/png;mock'};
 const document={createElement:()=>canvas};
 const L={imageOverlay(data,bounds,opts){overlay={bounds,options:opts,addTo(){return this;}};return overlay;}};
 const run=new Function('generateIDWHeatmapGrid','document','L','mapInstanceRef','heatLayerRef','heatPoints','boundary','autoHeatmapBoundary','maxInfluenceRadiusM','minInterpolationNeighbors','localCoverageRadiusM','valueToIntensity','gradient',colorFunction+effectBody);
 const spy=(points,polygon,opts)=>{options=opts;return generateIDWHeatmapGrid(points,polygon,opts);};
 run(spy,document,L,{current:{removeLayer(){}}},{current:null},samples,box(40),autoHeatmapBoundary,25,2,radius,v=>{calls.push(v);return v/100;},{0:'#ff0000',1:'#00ff00'});
 return{pixels:[...pixels.values()],overlay,canvas,options,calls};
}
test('SW02-STEP4L: actual renderer consumes 20 m settings and coverage alpha',()=>{
 const result=render([sample(0,0,40)]);assert.equal(result.options.localCoverageRadiusM,20);assert.equal(result.options.maxInfluenceRadiusM,25);assert.equal(result.options.minNeighbors,2);assert.equal(result.options.includeCoverage,true);
 assert.equal(result.canvas.width,257);assert.ok(result.pixels.length>100);assert.ok(result.calls.every(v=>v===40));
});
test('SW02-STEP4M: repeated source/grid pixels do not accumulate rendered alpha',()=>{
 const samples=[sample(0,0,40)],result=render(samples);
 const resolution=result.canvas.width-1,expected=new Map();
 for(const [lat,lng,,alpha] of grid(samples,box(40),{gridResolution:resolution})) {
  const min=point(-40,-40),max=point(40,40);
  const x=Math.max(0,Math.min(resolution,Math.round((lng-min[1])/(max[1]-min[1])*resolution)));
  const y=Math.max(0,Math.min(resolution,Math.round((max[0]-lat)/(max[0]-min[0])*resolution)));
  expected.set(`${x},${y}`,alpha);
 }
 assert.equal(result.pixels.length,expected.size);
 for(const p of result.pixels)close(p.alpha,expected.get(`${p.x},${p.y}`),1e-12);
 assert.deepEqual(result.pixels,render(Array(20).fill(samples[0])).pixels);
});
test('SW02-STEP4N: actual renderer blends overlapping samples without value inflation',()=>{
 const samples=[sample(0,-8,20),sample(0,8,80)],result=render(samples);
 assert.ok(result.calls.length>0);assert.ok(result.calls.every(v=>v>=20-1e-9&&v<=80+1e-9));
 assert.ok(result.pixels.every(p=>p.alpha>0&&p.alpha<=1));
});
test('SW02-STEP4O: installed Field Map explicitly enables final 20 m / 25 m / two-site settings',()=>{
 const tag=field.match(/<HeatmapMap\b[\s\S]*?\/>/g)?.find(t=>t.includes('heatPoints={heatPointsForLayer}'));
 assert.ok(tag,'Field Map heatmap call missing');
 const read=key=>Number(tag.match(new RegExp(key+'=\\{(\\d+)\\}'))?.[1]);
 console.log(`STEP4O installed configuration: local=${read('localCoverageRadiusM')}, search=${read('maxInfluenceRadiusM')}, neighbors=${read('minInterpolationNeighbors')}`);
 assert.equal(read('localCoverageRadiusM'),20,'FieldMapView overrides renderer default: set localCoverageRadiusM={20}');
 assert.equal(read('maxInfluenceRadiusM'),25);assert.equal(read('minInterpolationNeighbors'),2);
 assert.match(field,/Assumed coverage within 20 m of samples/,'Legend must match installed radius');
});
