param(
    [string]$ArduinoCli = 'arduino-cli',
    [string]$Board = 'esp32:esp32:esp32'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$checkRoot = Join-Path $repositoryRoot '.pio/mission-checks'
$sketches = [ordered]@{
    ground = 'embedded/LoRa RX_All/RX_Board_code_w_movement.ino'
    rover = 'embedded/ArduinoUnoESP32 serial test/oct21ESP32SerialTest/oct21ESP32SerialTest.ino'
}

# Compile wrappers isolate each source from unrelated historical .ino files in
# the same directory. This script contains no upload/flash command or COM port.
foreach ($name in $sketches.Keys) {
    $sketchRoot = Join-Path $checkRoot $name
    New-Item -ItemType Directory -Path $sketchRoot -Force | Out-Null
    $source = (Join-Path $repositoryRoot $sketches[$name]).Replace('\', '/')
    Set-Content -LiteralPath (Join-Path $sketchRoot "$name.ino") -Value ('#include "' + $source + '"') -Encoding UTF8
    & $ArduinoCli compile --fqbn $Board --build-path (Join-Path $checkRoot "$name-build") $sketchRoot
    if ($LASTEXITCODE -ne 0) { throw "$name firmware compilation failed ($LASTEXITCODE)." }
}
