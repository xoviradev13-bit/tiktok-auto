$ErrorActionPreference = "Stop"

$cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -match 'ClipFlow' } | Select-Object -First 1
if (-not $cert) {
    Write-Host "Generating self-signed code signing certificate..."
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=ClipFlow Developer, O=ClipFlow Systems' -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5)
}
Write-Host "Using Certificate: $($cert.Subject)"

if (Test-Path "dist\ClipFlow\ClipFlow.exe") {
    Set-AuthenticodeSignature -FilePath "dist\ClipFlow\ClipFlow.exe" -Certificate $cert -HashAlgorithm SHA256 | Out-Null
    Write-Host "Signed dist\ClipFlow\ClipFlow.exe successfully."
}

Write-Host "Compiling Inno Setup installer..."
& "C:\Users\datng\AppData\Local\Programs\Inno Setup 6\ISCC.exe" installer.iss
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup compilation failed with exit code $LASTEXITCODE"
}

if (Test-Path "dist_installer\ClipFlow_Setup_v1.0.0.exe") {
    Set-AuthenticodeSignature -FilePath "dist_installer\ClipFlow_Setup_v1.0.0.exe" -Certificate $cert -HashAlgorithm SHA256 | Out-Null
    Export-Certificate -Cert $cert -FilePath "dist_installer\ClipFlow_Developer.cer" -Force | Out-Null
    Write-Host "Successfully signed dist_installer\ClipFlow_Setup_v1.0.0.exe and exported certificate!"
}
