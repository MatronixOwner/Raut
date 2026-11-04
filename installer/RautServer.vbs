Option Explicit
' Запускает сервер Raut отдельно и показывает адреса для друзей в локальной сети.
Dim sh, fso, base, nodeExe, serverJs, clientDir, dataDir, q, port
Dim ip, wmi, col, it

q = Chr(34)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = base & "\bin\node.exe"
serverJs = base & "\app\server\index.js"
clientDir = base & "\app\client"
dataDir = base & "\app\data"
port = "8787"

If fso.FileExists(nodeExe) And fso.FileExists(serverJs) Then
    sh.CurrentDirectory = base
    sh.Run q & nodeExe & q & " " & q & serverJs & q & _
        " --client " & q & clientDir & q & " --data " & q & dataDir & q & _
        " --host 0.0.0.0 --port " & port, 0, False
End If

ip = "127.0.0.1"
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set col = wmi.ExecQuery("Select IPAddress from Win32_NetworkAdapterConfiguration where IPEnabled = True")
For Each it In col
    If Not IsNull(it.IPAddress) Then
        If it.IPAddress(0) <> "127.0.0.1" And InStr(it.IPAddress(0), ".") > 0 Then
            ip = it.IPAddress(0)
        End If
    End If
Next
On Error Goto 0

MsgBox "Сервер Raut запущен на порту " & port & "." & vbCrLf & vbCrLf & _
    "Этот компьютер:  http://127.0.0.1:" & port & "/" & vbCrLf & _
    "Локальная сеть:  http://" & ip & ":" & port & "/" & vbCrLf & vbCrLf & _
    "Для связи через интернет нужен HTTPS и свой TURN-сервер" & vbCrLf & _
    "(подробности — в README.txt и в Настройках, раздел «Сеть и сервер»).", _
    64, "Raut Server"
