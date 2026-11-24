$ErrorActionPreference = 'Stop'
# A local, interactive capture session. Each line is a JSON parameter object
# for capture-native-window.ps1, or the literal word quit. No arbitrary code.
Write-Output 'NATIVE_CAPTURE_SESSION_READY'
while ($null -ne ($captureRequestLine = [Console]::ReadLine())) {
  if ($captureRequestLine -eq 'quit') { break }
  try {
    $captureRequest = ConvertFrom-Json -InputObject $captureRequestLine
    $captureArguments = @{}
    foreach ($property in $captureRequest.PSObject.Properties) { $captureArguments[$property.Name] = $property.Value }
    & (Join-Path $PSScriptRoot 'capture-native-window.ps1') @captureArguments
    Write-Output 'NATIVE_CAPTURE_REQUEST_COMPLETE'
  } catch { Write-Output ('NATIVE_CAPTURE_REQUEST_FAILED: ' + $_.Exception.Message) }
}
