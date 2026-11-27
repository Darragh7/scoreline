<#
  ScoreLine static file server (no installs needed: uses .NET's built-in HttpListener).
  Serves this folder at http://localhost:5500/ so fetch() calls work (they fail under file://).

  Usage (from the project root):
      powershell -ExecutionPolicy Bypass -File .\serve.ps1            # port 5500
      powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8080
      powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Root .preview -Port 8000
  Stop with Ctrl+C. To preview the Django site without Python, use preview.ps1.
#>
param([int]$Port = 5500, [string]$Root = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $Root).Path.TrimEnd('\') + '\'
$prefix = "http://localhost:$Port/"

$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8';  '.js'  = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'; '.md' = 'text/markdown; charset=utf-8'
    '.svg'  = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'
    '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.txt' = 'text/plain; charset=utf-8'; '.pdf' = 'application/pdf'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
    Write-Host "Could not start the server on port $Port. Is something else already using it? Try -Port 5501." -ForegroundColor Red
    exit 1
}
Write-Host "ScoreLine is running at $prefix  (serving $root)" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request; $res = $ctx.Response
        $status = 200
        try {
            $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
            if ($rel -eq '' -or $rel.EndsWith('/')) { $rel = $rel + 'index.html' }
            $full = [IO.Path]::GetFullPath((Join-Path $root $rel))

            if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                $status = 403
            } elseif (Test-Path -LiteralPath $full -PathType Container) {
                $res.Redirect($req.Url.AbsolutePath.TrimEnd('/') + '/'); $status = 301
            } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
                $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
                $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
                $res.Headers.Add('Cache-Control', 'no-cache')
                $bytes = [IO.File]::ReadAllBytes($full)
                $res.ContentLength64 = $bytes.Length
                if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
            } else {
                $status = 404
            }

            if ($status -ge 400) {
                $msg = [Text.Encoding]::UTF8.GetBytes("$status - " + $(if ($status -eq 404) { 'Not found' } else { 'Forbidden' }))
                $res.StatusCode = $status
                $res.ContentType = 'text/plain; charset=utf-8'
                $res.OutputStream.Write($msg, 0, $msg.Length)
            }
        } catch {
            $status = 500
            try { $res.StatusCode = 500 } catch {}
        } finally {
            Write-Host ("{0} {1} {2}" -f $status, $req.HttpMethod, $req.Url.AbsolutePath)
            try { $res.OutputStream.Close() } catch {}
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
