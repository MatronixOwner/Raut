Option Explicit
' Raut launcher: поднимает локальный сервер (если он ещё не запущен)
' и открывает клиент в отдельном окне без адресной строки (Microsoft Edge / Chrome).
Dim sh, fso, base, nodeExe, serverJs, clientDir, dataDir, profileDir
Dim port, url, q, cmd, found, i, candidates(4)

q = Chr(34)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = base & "\bin\node.exe"
serverJs = base & "\app\server\index.js"
clientDir = base & "\app\client"
dataDir = base & "\app\data"
profileDir = base & "\profile"
port = "8787"
url = "http://127.0.0.1:" & port & "/"

' Сервер сам завершается, если порт уже занят предыдущим запуском.
If fso.FileExists(nodeExe) And fso.FileExists(serverJs) Then
    sh.CurrentDirectory = base
    sh.Run q & nodeExe & q & " " & q & serverJs & q & _
        " --client " & q & clientDir & q & " --data " & q & dataDir & q & _
        " --host 127.0.0.1 --port " & port, 0, False
End If
WScript.Sleep 800

found = ""
candidates(0) = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
candidates(1) = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
candidates(2) = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
candidates(3) = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe"
candidates(4) = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Google\Chrome\Application\chrome.exe"

For i = 0 To 4
    If found = "" And fso.FileExists(candidates(i)) Then found = candidates(i)
Next

If found <> "" Then
    cmd = q & found & q & " --app=" & q & url & q & _
        " --window-size=1440,900 --user-data-dir=" & q & profileDir & q & _
        " --no-first-run --no-default-browser-check"
    sh.Run cmd, 1, False
Else
    ' Если ни Edge, ни Chrome не найдены — откроем в браузере по умолчанию.
    sh.Run url, 1, False
End If
