$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8
$word = New-Object -ComObject Word.Application; $word.Visible=$false
$doc = $word.Documents.Open('C:\laragon\www\zomatel-planning\document\rapport_stage_zomatel.docx', $false, $true)
# Range des 5 premiers paragraphes, sauvage en UTF-8 sans BOM
$r = $doc.Range(0, 400)
[System.IO.File]::WriteAllText('C:\laragon\www\zomatel-planning\tmp\rapport\word_head.txt', $r.Text, (New-Object System.Text.UTF8Encoding($false)))
# Statistiques de rendu (vérification que le document est utilisable)
$ws = $doc.ComputeStatistics(0); $ps = $doc.ComputeStatistics(2)
[System.IO.File]::WriteAllText('C:\laragon\www\zomatel-planning\tmp\rapport\word_stats.txt', "WORDS=$ws PAGES=$ps", (New-Object System.Text.UTF8Encoding($false)))
$doc.Close($false)
$word.Quit()
Write-Output "DONE"
