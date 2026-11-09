$ErrorActionPreference = 'Stop'
$mosquittoDir = 'C:\Program Files\mosquitto'
$brokerExe = Join-Path $mosquittoDir 'mosquitto.exe'
$profileDir = Join-Path $env:USERPROFILE 'mosquitto-smartfish'
$configFile = Join-Path $profileDir 'smartfish-1884.conf'
$pidFile = Join-Path $profileDir 'mosquitto-1884.pid'
if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { throw "Second-broker PID file not found: $pidFile. No process was stopped." }
$pidText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
$brokerPid = 0
if (-not [int]::TryParse($pidText, [ref]$brokerPid)) { throw "PID file is invalid. No process was stopped: $pidFile" }
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $brokerPid" -ErrorAction SilentlyContinue
if (-not $process) {
    $stillRunning = Get-Process -Id $brokerPid -ErrorAction SilentlyContinue
    if ($stillRunning) { throw "PID $brokerPid exists but its command line could not be verified. No process was stopped and PID file was kept." }
    Remove-Item -LiteralPath $pidFile -Force
    Write-Host 'Second broker is already stopped; stale PID file removed.'
} else {
    if ($process.ExecutablePath -ne $brokerExe -or $process.CommandLine -notlike "*$configFile*") { throw "PID $brokerPid does not match the Smart Fish broker/config. No process was stopped." }
    Stop-Process -Id $brokerPid
    Wait-Process -Id $brokerPid -Timeout 10 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force
    Write-Host "Smart Fish broker PID $brokerPid stopped."
}
$service = Get-Service -Name 'mosquitto' -ErrorAction SilentlyContinue
if ($service) { $service.Refresh(); Write-Host "Existing Mosquitto service: $($service.Status). This script does not stop the service." }