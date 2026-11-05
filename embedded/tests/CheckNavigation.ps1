param([switch]$HostOnly,[string]$ArduinoCli,[string]$HostCompiler)
$ErrorActionPreference='Stop'
$repoPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$outputPath=Join-Path $repoPath '.pio/navigation-checks'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
Push-Location $repoPath
try {
  if(!$HostCompiler){$found=Get-Command g++ -ErrorAction SilentlyContinue;if($found){$HostCompiler=$found.Source}}
  foreach($hostTest in @('navigation_test','rc_safety_test')){
  if($HostCompiler){
    & $HostCompiler -std=c++11 -Wall -Wextra -pedantic -Iembedded/shared (Join-Path 'embedded/tests' ($hostTest+'.cpp')) -o (Join-Path $outputPath ($hostTest+'.exe'))
  }else{
    $vsCandidates=@('C:\Program Files\Microsoft Visual Studio\2022\Preview\Common7\Tools\VsDevCmd.bat',
      'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat',
      'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat')
    $vsCommand=$vsCandidates|Where-Object{Test-Path -LiteralPath $_}|Select-Object -First 1
    if(!$vsCommand){throw 'Install a host C++ compiler (G++ or MSVC); no hardware simulation was run.'}
    # All command operands are fixed repository-relative build paths. No file
    # enumeration/deletion or cross-shell destructive operations are performed.
    & cmd /d /c "`"$vsCommand`" -arch=x64 -host_arch=x64 >nul && cl /nologo /EHsc /std:c++14 /D_CRT_SECURE_NO_WARNINGS /Iembedded\shared embedded\tests\$hostTest.cpp /Fe:.pio\navigation-checks\$hostTest.exe /Fo:.pio\navigation-checks\$hostTest.obj"
  }
  if($LASTEXITCODE-ne 0){throw 'Host controller compilation failed.'}
  & (Join-Path $outputPath ($hostTest+'.exe'))
  if($LASTEXITCODE-ne 0){throw 'Host protocol/estimator/controller/calibration simulation failed.'}
  }
  if(!$HostOnly){
    if(!$ArduinoCli){$found=Get-Command arduino-cli -ErrorAction SilentlyContinue;if($found){$ArduinoCli=$found.Source}
      else{$ArduinoCli='C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'}}
    if(!(Test-Path -LiteralPath $ArduinoCli)){throw 'Arduino CLI not found; firmware was not compiled.'}
    $targets=@(@('mega','arduino:avr:mega','mega/Mega_A3_0'),@('rover','esp32:esp32:esp32','rover/Rover_A3_0'),@('receiver','esp32:esp32:esp32','desktop/Receiver_A3_0'))
    foreach($target in $targets){
      & $ArduinoCli compile --fqbn $target[1] --libraries embedded/libraries --build-path (Join-Path $outputPath ($target[0]+'-build')) (Join-Path 'embedded/1 Final Microcontroller Firmwares (unuploaded)' $target[2])
      if($LASTEXITCODE-ne 0){throw ('Firmware target failed: '+$target[0])}
    }
  }
} finally {Pop-Location}
