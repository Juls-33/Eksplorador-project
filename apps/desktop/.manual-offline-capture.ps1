param([string]$CaptureName = 'overview', [switch]$OpenOffline, [int]$ClickX = -1, [int]$ClickY = -1, [int]$Wheel = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class OfflineCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
  public static IntPtr FindWindow(uint processId) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => { uint id; GetWindowThreadProcessId(h, out id); if (id == processId && IsWindowVisible(h)) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static IntPtr FindRenderer(IntPtr parent) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(parent, (h, p) => { var s = new StringBuilder(256); GetClassName(h, s, 256); if (s.ToString() == "Chrome_RenderWidgetHostHWND") { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
'@
[OfflineCapture]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$offlineApp = Get-Process desktop | Select-Object -First 1
$offlineWindow = [OfflineCapture]::FindWindow([uint32]$offlineApp.Id)
if ($offlineWindow -eq [IntPtr]::Zero) { throw 'Native desktop window not found' }
[OfflineCapture]::ShowWindow($offlineWindow, 3) | Out-Null
Start-Sleep -Milliseconds 250
$offlineRenderer = [OfflineCapture]::FindRenderer($offlineWindow)
if ($offlineRenderer -eq [IntPtr]::Zero) { throw 'Native webview renderer not found' }
if ($OpenOffline) { $ClickX = 180; $ClickY = 518 }
if ($ClickX -ge 0 -and $ClickY -ge 0) {
  $offlineClick = [IntPtr](($ClickY -shl 16) -bor $ClickX)
  [OfflineCapture]::PostMessage($offlineRenderer, 0x0200, [IntPtr]::Zero, $offlineClick) | Out-Null
  [OfflineCapture]::PostMessage($offlineRenderer, 0x0201, [IntPtr]1, $offlineClick) | Out-Null
  [OfflineCapture]::PostMessage($offlineRenderer, 0x0202, [IntPtr]::Zero, $offlineClick) | Out-Null
}
if ($Wheel -ne 0) {
  [OfflineCapture]::PostMessage($offlineRenderer, 0x020A, [IntPtr]($Wheel -shl 16), [IntPtr]((1250 -shl 16) -bor 2400)) | Out-Null
}
Start-Sleep -Milliseconds 1800
$offlineRect = New-Object OfflineCapture+RECT
[OfflineCapture]::GetClientRect($offlineWindow, [ref]$offlineRect) | Out-Null
$offlineBitmap = New-Object System.Drawing.Bitmap ($offlineRect.Right), ($offlineRect.Bottom)
$offlineGraphics = [System.Drawing.Graphics]::FromImage($offlineBitmap)
$offlineDc = $offlineGraphics.GetHdc()
try { $offlineCaptured = [OfflineCapture]::PrintWindow($offlineWindow, $offlineDc, 3) } finally { $offlineGraphics.ReleaseHdc($offlineDc) }
if (-not $offlineCaptured) { throw 'Native app capture failed' }
$offlineCaptureDir = Join-Path $env:TEMP 'eksplorador-offline-captures'
New-Item -ItemType Directory -Force -Path $offlineCaptureDir | Out-Null
$offlineCapturePath = Join-Path $offlineCaptureDir ($CaptureName + '.png')
$offlineBitmap.Save($offlineCapturePath, [System.Drawing.Imaging.ImageFormat]::Png)
$offlineGraphics.Dispose()
$offlineBitmap.Dispose()
Write-Output $offlineCapturePath
