[CmdletBinding()]
param(
    [string]$BrokerIp = '10.4.25.188',
    [int]$Port = 1884
)
$ErrorActionPreference = 'Stop'
$mosquittoDir = 'C:\Program Files\mosquitto'
$brokerExe = Join-Path $mosquittoDir 'mosquitto.exe'
$profileDir = Join-Path $env:USERPROFILE 'mosquitto-smartfish'
$passwordFile = Join-Path $profileDir 'passwords.txt'
$configFile = Join-Path $profileDir 'smartfish-1884.conf'
$dataDir = Join-Path $profileDir 'data-1884'
$logFile = Join-Path $profileDir 'mosquitto-1884.log'
$pidFile = Join-Path $profileDir 'mosquitto-1884.pid'
if (-not (Test-Path -LiteralPath $brokerExe -PathType Leaf)) { throw "Mosquitto executable not found: $brokerExe" }
if (-not (Test-Path -LiteralPath $passwordFile -PathType Leaf)) { throw "Password file not found: $passwordFile. Create it interactively with mosquitto_passwd first." }
if (-not (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -eq $BrokerIp })) { throw "Bind IP $BrokerIp is not assigned on this computer. Check Wi-Fi IP and rerun with -BrokerIp." }
$service = Get-Service -Name 'mosquitto' -ErrorAction SilentlyContinue
if ($service) { Write-Host "Existing Mosquitto service: $($service.Status) / $($service.StartType). The service will not be changed." }
$existingListener = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($existingListener.Count -gt 0) {
    $owners = ($existingListener | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    throw "TCP port $Port is already in use (PID $owners). The new broker was not started and the existing process was not stopped."
}
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$passwordFileConfig = $passwordFile.Replace('\', '/')
$dataDirConfig = ($dataDir.TrimEnd('\') + '\').Replace('\', '/')
$logFileConfig = $logFile.Replace('\', '/')
$configText = @"
listener $Port $BrokerIp
allow_anonymous false
password_file $passwordFileConfig
persistence true
persistence_location $dataDirConfig
log_dest file $logFileConfig
"@
Set-Content -LiteralPath $configFile -Value $configText -Encoding ASCII
$argLine = '-c "' + $configFile + '"'
$process = Start-Process -FilePath $brokerExe -ArgumentList $argLine -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII
$deadline = (Get-Date).AddSeconds(10)
$listener = @()
do {
    Start-Sleep -Milliseconds 250
    if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { break }
    $listener = @(Get-NetTCPConnection -LocalAddress $BrokerIp -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $process.Id })
} while ($listener.Count -eq 0 -and (Get-Date) -lt $deadline)
if ($listener.Count -eq 0) {
    $stillRunning = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if ($stillRunning) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $logFile) { Write-Host 'Mosquitto log tail:'; Get-Content -LiteralPath $logFile -Tail 20 }
    throw ("The second broker did not listen on {0}:{1}. The existing Mosquitto service was not touched." -f $BrokerIp, $Port)
}
Write-Host ("Smart Fish broker is running on {0}:{1} (PID {2})." -f $BrokerIp, $Port, $process.Id)
Write-Host "Configuration: $configFile"
Write-Host "Password file was used without being read or displayed: $passwordFile"
if ($service) { $service.Refresh(); Write-Host "Existing Mosquitto service remains: $($service.Status)." }