param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$CaptureName,
  [int]$ClientWidth = 0, [int]$ClientHeight = 0,
  [switch]$Maximize,
  [int]$ClickX = -1, [int]$ClickY = -1,
  [int]$DragToX = -1, [int]$DragToY = -1,
  [int]$Wheel = 0, [int]$WheelX = 500, [int]$WheelY = 400,
  [string]$Text = '',
  [Parameter(Mandatory=$true)][string]$SourceScreen,
  [Parameter(Mandatory=$true)][string]$DataState,
  [string]$Limitations = '',
  [int]$SettleMs = 1600
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ManualNativeCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT point);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static IntPtr FindWindow(uint processId) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((h,p)=> { uint id; RECT r; GetWindowThreadProcessId(h,out id); GetClientRect(h,out r);
      if(id==processId && IsWindowVisible(h) && r.Right>300 && r.Bottom>200) {found=h;return false;} return true;},IntPtr.Zero);
    return found;
  }
  public static IntPtr FindRenderer(IntPtr parent) {
    IntPtr found=IntPtr.Zero;
    EnumChildWindows(parent,(h,p)=> {var s=new StringBuilder(256); GetClassName(h,s,256);
      if(s.ToString()=="Chrome_RenderWidgetHostHWND") {found=h;return false;} return true;},IntPtr.Zero);
    return found;
  }
}
'@
$previousDpi = [ManualNativeCapture]::SetThreadDpiAwarenessContext([IntPtr](-4))
$capturePath = Join-Path $PSScriptRoot ($CaptureName + '.png')
if (Test-Path -LiteralPath $capturePath) { throw 'Refusing to overwrite an existing original capture. Choose a new name.' }
$expectedExe = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../apps/desktop/src-tauri/target/debug/desktop.exe'))
$captureApps = @(Get-Process -Name desktop | Where-Object { $_.Path -eq $expectedExe })
if ($captureApps.Count -ne 1) { throw 'Expected exactly one native desktop.exe from this project.' }
$captureApp = $captureApps[0]
$captureWindow = [ManualNativeCapture]::FindWindow([uint32]$captureApp.Id)
if ($captureWindow -eq [IntPtr]::Zero) { throw 'No accessible visible native Tauri app window. No screenshot taken.' }
$originalClient = New-Object ManualNativeCapture+RECT
$originalWindow = New-Object ManualNativeCapture+RECT
[ManualNativeCapture]::GetClientRect($captureWindow,[ref]$originalClient) | Out-Null
[ManualNativeCapture]::GetWindowRect($captureWindow,[ref]$originalWindow) | Out-Null
if ($ClientWidth -gt 0 -or $ClientHeight -gt 0) {
  if ($ClientWidth -lt 800 -or $ClientHeight -lt 600) { throw 'Specify both dimensions, at least 800 by 600.' }
  [ManualNativeCapture]::ShowWindow($captureWindow,9) | Out-Null
  Start-Sleep -Milliseconds 250
  $resizeClient = New-Object ManualNativeCapture+RECT
  $resizeWindow = New-Object ManualNativeCapture+RECT
  [ManualNativeCapture]::GetClientRect($captureWindow,[ref]$resizeClient) | Out-Null
  [ManualNativeCapture]::GetWindowRect($captureWindow,[ref]$resizeWindow) | Out-Null
  $resizeWidth = $ClientWidth + $resizeWindow.Right - $resizeWindow.Left - $resizeClient.Right
  $resizeHeight = $ClientHeight + $resizeWindow.Bottom - $resizeWindow.Top - $resizeClient.Bottom
  if (-not [ManualNativeCapture]::SetWindowPos($captureWindow,[IntPtr]::Zero,10,10,$resizeWidth,$resizeHeight,0x0014)) { throw 'Native window resize failed.' }
  Start-Sleep -Milliseconds 350
}
if ($Maximize) { [ManualNativeCapture]::ShowWindow($captureWindow,3) | Out-Null; Start-Sleep -Milliseconds 350 }
$captureRenderer = [ManualNativeCapture]::FindRenderer($captureWindow)
if (($ClickX -ge 0 -and $ClickY -ge 0) -or $Wheel -ne 0 -or $Text) {
  if ($captureRenderer -eq [IntPtr]::Zero) { throw 'Native webview renderer unavailable. No interaction attempted.' }
  $rendererRect = New-Object ManualNativeCapture+RECT
  [ManualNativeCapture]::GetClientRect($captureRenderer,[ref]$rendererRect) | Out-Null
  if ($ClickX -ge 0 -and $ClickY -ge 0) {
    if ($ClickX -ge $rendererRect.Right -or $ClickY -ge $rendererRect.Bottom) { throw 'Click outside renderer.' }
    $clickPoint = [IntPtr](($ClickY -shl 16) -bor $ClickX)
    [ManualNativeCapture]::PostMessage($captureRenderer,0x0200,[IntPtr]::Zero,$clickPoint) | Out-Null
    [ManualNativeCapture]::PostMessage($captureRenderer,0x0201,[IntPtr]1,$clickPoint) | Out-Null
    if ($DragToX -ge 0 -and $DragToY -ge 0) {
      if ($DragToX -ge $rendererRect.Right -or $DragToY -ge $rendererRect.Bottom) { throw 'Drag outside renderer.' }
      for ($dragStep = 1; $dragStep -le 12; $dragStep++) {
        $dragX = [int]($ClickX + ($DragToX-$ClickX)*$dragStep/12)
        $dragY = [int]($ClickY + ($DragToY-$ClickY)*$dragStep/12)
        [ManualNativeCapture]::PostMessage($captureRenderer,0x0200,[IntPtr]1,[IntPtr](($dragY -shl 16) -bor $dragX)) | Out-Null
        Start-Sleep -Milliseconds 30
      }
      $clickPoint = [IntPtr](($DragToY -shl 16) -bor $DragToX)
    }
    [ManualNativeCapture]::PostMessage($captureRenderer,0x0202,[IntPtr]::Zero,$clickPoint) | Out-Null
    Start-Sleep -Milliseconds 150
  }
  if ($Text) {
    foreach ($character in $Text.ToCharArray()) { [ManualNativeCapture]::PostMessage($captureRenderer,0x0102,[IntPtr][int][char]$character,[IntPtr]1) | Out-Null }
  }
  if ($Wheel -ne 0) {
    [ManualNativeCapture]::PostMessage($captureRenderer,0x0200,[IntPtr]::Zero,[IntPtr](($WheelY -shl 16) -bor $WheelX)) | Out-Null
    Start-Sleep -Milliseconds 100
    $wheelPoint = New-Object ManualNativeCapture+POINT
    $wheelPoint.X = $WheelX; $wheelPoint.Y = $WheelY
    [ManualNativeCapture]::ClientToScreen($captureRenderer,[ref]$wheelPoint) | Out-Null
    [ManualNativeCapture]::PostMessage($captureRenderer,0x020A,[IntPtr]($Wheel -shl 16),[IntPtr](($wheelPoint.Y -shl 16) -bor ($wheelPoint.X -band 0xffff))) | Out-Null
  }
}
Start-Sleep -Milliseconds $SettleMs
$captureClient = New-Object ManualNativeCapture+RECT
$captureOuter = New-Object ManualNativeCapture+RECT
[ManualNativeCapture]::GetClientRect($captureWindow,[ref]$captureClient) | Out-Null
[ManualNativeCapture]::GetWindowRect($captureWindow,[ref]$captureOuter) | Out-Null
$captureBitmap = New-Object System.Drawing.Bitmap ($captureClient.Right),($captureClient.Bottom)
$captureGraphics = [System.Drawing.Graphics]::FromImage($captureBitmap)
$captureDc = $captureGraphics.GetHdc()
try { $captureOk = [ManualNativeCapture]::PrintWindow($captureWindow,$captureDc,3) }
finally { $captureGraphics.ReleaseHdc($captureDc) }
try {
  if (-not $captureOk) { throw 'PrintWindow failed. No screenshot saved.' }
  $captureBitmap.Save($capturePath,[System.Drawing.Imaging.ImageFormat]::Png)
} finally { $captureGraphics.Dispose(); $captureBitmap.Dispose() }
$localTime = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'Singapore Standard Time')
$repoCommit = (git -C $PSScriptRoot rev-parse HEAD).Trim()
$record = [ordered]@{
  file=($CaptureName+'.png'); localTime=$localTime.ToString('yyyy-MM-ddTHH:mm:sszzz'); timeZone='Asia/Manila';
  processId=$captureApp.Id; executable=$captureApp.Path; executableVersion=(Get-Item -LiteralPath $captureApp.Path).VersionInfo.FileVersion;
  executableSha256=(Get-FileHash -LiteralPath $captureApp.Path -Algorithm SHA256).Hash;
  repositoryCommit=$repoCommit; runningCommitVerified=$false;
  clientPixels=@($captureClient.Right,$captureClient.Bottom); windowPixels=@(($captureOuter.Right-$captureOuter.Left),($captureOuter.Bottom-$captureOuter.Top));
  windowRect=@($captureOuter.Left,$captureOuter.Top,$captureOuter.Right,$captureOuter.Bottom);
  originalClientPixels=@($originalClient.Right,$originalClient.Bottom); originalWindowRect=@($originalWindow.Left,$originalWindow.Top,$originalWindow.Right,$originalWindow.Bottom);
  dpi=[ManualNativeCapture]::GetDpiForWindow($captureWindow); method='Windows PrintWindow flags=3 (entire native client)';
  sourceScreen=$SourceScreen; cropRectangle=$null; realDataState=$DataState; limitations=$Limitations;
  click=@($ClickX,$ClickY); dragTo=@($DragToX,$DragToY); wheel=$Wheel; typedText=$Text; sha256=(Get-FileHash -LiteralPath $capturePath -Algorithm SHA256).Hash
}
$record | ConvertTo-Json -Depth 5 -Compress | Add-Content -Encoding utf8 -LiteralPath (Join-Path $PSScriptRoot 'capture-log.jsonl')
$record | ConvertTo-Json -Depth 5
