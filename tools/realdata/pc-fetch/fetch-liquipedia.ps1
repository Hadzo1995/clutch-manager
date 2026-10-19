# Fetches Liquipedia player pages for Clutch Manager (free fan game) through the
# official MediaWiki API: about 11 requests, one every 3 seconds, gzip, with contact info.
# It only downloads; the results are read later by Claude. Content: Liquipedia, CC BY-SA 3.0.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'raw'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
$client = New-Object System.Net.Http.HttpClient($handler)
# Liquipedia asks for a contact address in the request header. It is read from contact.txt
# next to this script (kept out of the repository), or asked for.
$contactFile = Join-Path $here 'contact.txt'
$contact = if (Test-Path $contactFile) { (Get-Content $contactFile -Raw).Trim() } else { Read-Host 'Contact email for the Liquipedia request header' }
$client.DefaultRequestHeaders.UserAgent.ParseAdd("ClutchManagerFanGame/0.1 (free non-commercial CS2 manager fan game; roster import; $contact)")
$client.DefaultRequestHeaders.AcceptEncoding.ParseAdd('gzip')
$titles = @(Get-Content (Join-Path $here 'titles.txt') -Encoding UTF8 | Where-Object { $_.Trim() -ne '' })
$n = 0
for ($i = 0; $i -lt $titles.Count; $i += 50) {
  $chunk = $titles[$i..([Math]::Min($i + 49, $titles.Count - 1))]
  $t = [Uri]::EscapeDataString(($chunk -join '|'))
  $url = "https://liquipedia.net/counterstrike/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=$t"
  $n++
  Write-Host "Request $n of $([Math]::Ceiling($titles.Count / 50))..."
  $resp = $client.GetAsync($url).Result
  if (-not $resp.IsSuccessStatusCode) { Write-Host "Liquipedia answered $([int]$resp.StatusCode). Stopping; try again later." -ForegroundColor Red; break }
  $body = $resp.Content.ReadAsStringAsync().Result
  [IO.File]::WriteAllText((Join-Path $out ("batch{0:D2}.json" -f $n)), $body, (New-Object Text.UTF8Encoding($false)))
  Start-Sleep -Seconds 3
}
Write-Host "Done. Files are in $out. You can close this window and tell Claude." -ForegroundColor Green
