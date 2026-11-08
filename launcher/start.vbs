' IPTVKZ: sobe o servidor local escondido (se ainda não estiver rodando)
' e abre o app numa janela própria do Chrome (ou Edge).
Option Explicit
Dim sh, fso, root, url, i, browser, localApp
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
url = "http://localhost:8787"

Function ServerUp()
  Dim x
  ServerUp = False
  On Error Resume Next
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 500, 500, 800, 800
  x.open "GET", url & "/api/ping", False
  x.send
  If Err.Number = 0 Then
    If x.status = 200 Then ServerUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

If Not ServerUp() Then
  sh.CurrentDirectory = root
  If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
  sh.Run "cmd /c node server.js > data\server.log 2>&1", 0, False
  For i = 1 To 60
    WScript.Sleep 250
    If ServerUp() Then Exit For
  Next
End If

' "/server": só sobe o servidor (usado no "Iniciar com o Windows"), sem abrir janela.
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/server" Then WScript.Quit 0
End If

localApp = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")
browser = ""
If fso.FileExists("C:\Program Files\Google\Chrome\Application\chrome.exe") Then
  browser = "C:\Program Files\Google\Chrome\Application\chrome.exe"
ElseIf fso.FileExists("C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") Then
  browser = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
ElseIf fso.FileExists(localApp & "\Google\Chrome\Application\chrome.exe") Then
  browser = localApp & "\Google\Chrome\Application\chrome.exe"
ElseIf fso.FileExists("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe") Then
  browser = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
End If

If browser <> "" Then
  sh.Run """" & browser & """ --app=" & url & " --window-size=1440,900", 1, False
Else
  sh.Run url, 1, False
End If
