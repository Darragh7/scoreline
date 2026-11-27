<#
  Preview the Django site WITHOUT Python (no installs).

  Builds a static copy of the Django pages in .preview\ :
    - Django/ScoreLine/Templates/{index,predictor,about,contact}.html with the template tags filled in
      ({% static 'x' %} -> /static/x, {% url 'predictions_api' %} -> /api/predictions/)
    - Django/ScoreLine/static/            -> /static/
    - data/predictions.json               -> /api/predictions/   (what Django's endpoint returns)
  then serves it at http://localhost:8000/ with serve.ps1.

  Usage (from the project root):
      powershell -ExecutionPolicy Bypass -File .\preview.ps1
      powershell -ExecutionPolicy Bypass -File .\preview.ps1 -Port 8001
  Stop with Ctrl+C. Re-run after editing templates or static files.

  This is a stand-in for `python manage.py runserver`, not real Django: only the tags above are
  supported, and server-side features (views, forms, CSRF) don't run.
#>
param([int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path $PSScriptRoot).Path
$templates   = Join-Path $projectRoot 'Django\ScoreLine\Templates'
$static      = Join-Path $projectRoot 'Django\ScoreLine\static'
$predictions = if ($env:PREDICTIONS_FILE) { $env:PREDICTIONS_FILE } else { Join-Path $projectRoot 'data\predictions.json' }
$out         = Join-Path $projectRoot '.preview'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($page in 'index', 'predictor', 'about', 'contact') {
    $src = Join-Path $templates "$page.html"
    if (-not (Test-Path $src)) { Write-Host "Missing template: $src" -ForegroundColor Yellow; continue }
    $html = [IO.File]::ReadAllText($src, $utf8)
    $html = [regex]::Replace($html, '\{%\s*load\s+static\s*%\}\r?\n?', '')
    $html = [regex]::Replace($html, "\{%\s*static\s+'([^']+)'\s*%\}", '/static/$1')
    $html = [regex]::Replace($html, "\{%\s*url\s+'predictions_api'\s*%\}", '/api/predictions/')
    if ($html -match '\{%|\{\{') { Write-Host "Note: $page.html still contains Django tags this preview can't fill in." -ForegroundColor Yellow }
    [IO.File]::WriteAllText((Join-Path $out "$page.html"), $html, $utf8)
}

Copy-Item $static (Join-Path $out 'static') -Recurse

$apiDir = Join-Path $out 'api\predictions'
New-Item -ItemType Directory -Path $apiDir -Force | Out-Null
if (Test-Path $predictions) {
    Copy-Item $predictions (Join-Path $apiDir 'index.html')
} else {
    Write-Host "No predictions file at $predictions - the predictor will show its error message." -ForegroundColor Yellow
}

Write-Host "Preview built in .preview\ (not real Django)." -ForegroundColor DarkGray
& (Join-Path $projectRoot 'serve.ps1') -Root $out -Port $Port
