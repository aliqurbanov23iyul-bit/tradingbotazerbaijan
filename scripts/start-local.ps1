$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

if (!(Test-Path -LiteralPath '.env')) {
    $password = Read-Host 'Choose an admin password (at least 14 characters)' -MaskInput
    try {
        if ($password.Length -lt 14 -or $password.Length -gt 256) {
            throw 'Use a password of 14–256 characters.'
        }
        $hash = $password | node scripts/hash.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Password hashing failed.' }
    } finally {
        Remove-Variable password -ErrorAction SilentlyContinue
    }
    $secret = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
    if ($LASTEXITCODE -ne 0) { throw 'Session key generation failed.' }
    $config = "ADMIN_USERNAME=admin`nADMIN_PASSWORD_HASH=$hash`nSESSION_SECRET=$secret`nPORT=3100`n"
    [IO.File]::WriteAllText((Join-Path (Get-Location).Path '.env'), $config)
    Write-Host 'Admin username: admin'
}

node --env-file=.env server.mjs
