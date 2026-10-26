param([int]$SourceX, [int]$SourceY, [int]$TargetX, [int]$TargetY)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TestDragPointer {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[TestDragPointer]::SetProcessDPIAware() | Out-Null
[TestDragPointer]::SetCursorPos($SourceX, $SourceY) | Out-Null
Start-Sleep -Milliseconds 100
[TestDragPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
try {
  for ($step = 1; $step -le 20; $step++) {
    $pointX = [int]($SourceX + ($TargetX - $SourceX) * $step / 20)
    $pointY = [int]($SourceY + ($TargetY - $SourceY) * $step / 20)
    [TestDragPointer]::SetCursorPos($pointX, $pointY) | Out-Null
    Start-Sleep -Milliseconds 60
  }
  Start-Sleep -Milliseconds 150
} finally {
  [TestDragPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}
