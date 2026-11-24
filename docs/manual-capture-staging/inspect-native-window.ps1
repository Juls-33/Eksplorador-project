$ErrorActionPreference = 'Stop'
# Read-only capability check. Does not launch, resize, click, or capture an app.
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class ManualWindowInspection {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  public static string[] Windows(uint processId) {
    var rows = new List<string>();
    EnumWindows((h,p) => {
      uint id; GetWindowThreadProcessId(h,out id);
      if (id == processId) {
        var title = new StringBuilder(512); GetWindowText(h,title,512);
        RECT client, window; GetClientRect(h,out client); GetWindowRect(h,out window);
        rows.Add(String.Format("hwnd={0}; visible={1}; title={2}; client={3}x{4}; window=({5},{6},{7},{8})", h,IsWindowVisible(h),title,client.Right,client.Bottom,window.Left,window.Top,window.Right,window.Bottom));
      }
      return true;
    },IntPtr.Zero);
    return rows.ToArray();
  }
}
'@
$inspectionTime = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'Singapore Standard Time')
Write-Output ('Inspection time (Asia/Manila): ' + $inspectionTime.ToString('yyyy-MM-ddTHH:mm:sszzz'))
Write-Output ('Inspector session: ' + (Get-Process -Id $PID).SessionId)
$inputDesktop = [ManualWindowInspection]::OpenInputDesktop(0, $false, 1)
$desktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
Write-Output ('Input desktop accessible: ' + ($inputDesktop -ne [IntPtr]::Zero) + '; Win32 error=' + $desktopError)
if ($inputDesktop -ne [IntPtr]::Zero) { [ManualWindowInspection]::CloseDesktop($inputDesktop) | Out-Null }
$nativeApps = @(Get-Process -Name desktop -ErrorAction SilentlyContinue)
if ($nativeApps.Count -eq 0) { throw 'No running desktop.exe process was found.' }
$foundVisible = $false
foreach ($nativeApp in $nativeApps) {
  $nativeApp | Select-Object Id, ProcessName, SessionId, Path, StartTime | Format-List
  if ($nativeApp.Path) {
    Get-Item -LiteralPath $nativeApp.Path | Select-Object FullName, Length, LastWriteTimeUtc, @{n='FileVersion';e={$_.VersionInfo.FileVersion}} | Format-List
    Get-FileHash -LiteralPath $nativeApp.Path -Algorithm SHA256 | Format-List
  }
  $windowRows = [ManualWindowInspection]::Windows([uint32]$nativeApp.Id)
  Write-Output ('Enumerated process windows: ' + $windowRows.Count)
  $windowRows | Write-Output
  if ($windowRows -match 'visible=True') { $foundVisible = $true }
}
if (-not $foundVisible) { throw 'No visible native desktop.exe window is accessible in this execution desktop.' }
