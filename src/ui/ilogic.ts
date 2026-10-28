// Regla iLogic (VB.NET) para exportar todo el proyecto activo de Inventor a STEP (piezas y ensamblajes) y DWG (planos).
export const ILOGIC_RULE = `' INV3D — Exportación masiva del proyecto activo de Inventor
' Piezas (.ipt) y ensamblajes (.iam) -> STEP AP214 · Planos (.idw) -> DWG
' Salida: <espacio de trabajo>\\_EXPORT_INV3D
Imports System.IO

Sub Main()
    Dim proj As DesignProject = ThisApplication.DesignProjectManager.ActiveDesignProject
    Dim root As String = proj.WorkspacePath
    Dim outDir As String = Path.Combine(root, "_EXPORT_INV3D")
    If Not Directory.Exists(outDir) Then Directory.CreateDirectory(outDir)

    Dim stepAddin As TranslatorAddIn = ThisApplication.ApplicationAddIns.ItemById("{90AF7F40-0C01-11D5-8E83-0010B541CD80}")
    Dim dwgAddin As TranslatorAddIn = ThisApplication.ApplicationAddIns.ItemById("{C24E3AC2-122E-11D5-8E91-0010B541CD80}")
    Dim ok As Integer = 0, fallos As Integer = 0
    ThisApplication.SilentOperation = True

    For Each f As String In Directory.GetFiles(root, "*.*", SearchOption.AllDirectories)
        Dim ext As String = Path.GetExtension(f).ToLower()
        If f.Contains("\\OldVersions\\") Or f.Contains("_EXPORT_INV3D") Then Continue For
        If ext <> ".ipt" And ext <> ".iam" And ext <> ".idw" Then Continue For
        Dim rel As String = f.Substring(root.Length).TrimStart("\\"c)
        Dim destBase As String = Path.Combine(outDir, Path.ChangeExtension(rel, Nothing))
        Directory.CreateDirectory(Path.GetDirectoryName(destBase))
        Dim doc As Document = Nothing
        Try
            doc = ThisApplication.Documents.Open(f, False)
            Dim ctx As TranslationContext = ThisApplication.TransientObjects.CreateTranslationContext()
            ctx.Type = IOMechanismEnum.kFileBrowseIOMechanism
            Dim opts As NameValueMap = ThisApplication.TransientObjects.CreateNameValueMap()
            Dim data As DataMedium = ThisApplication.TransientObjects.CreateDataMedium()
            If ext = ".idw" Then
                If dwgAddin.HasSaveCopyAsOptions(doc, ctx, opts) Then opts.Value("Export_Acad_IniFile") = ""
                data.FileName = destBase & ".dwg"
                dwgAddin.SaveCopyAs(doc, ctx, opts, data)
            Else
                If stepAddin.HasSaveCopyAsOptions(doc, ctx, opts) Then opts.Value("ApplicationProtocolType") = 3 ' AP214
                data.FileName = destBase & ".stp"
                stepAddin.SaveCopyAs(doc, ctx, opts, data)
            End If
            ok += 1
        Catch ex As Exception
            fallos += 1
            Logger.Error(f & ": " & ex.Message)
        Finally
            If doc IsNot Nothing Then doc.Close(True)
        End Try
    Next

    ThisApplication.SilentOperation = False
    MessageBox.Show(ok & " ficheros exportados a " & outDir & If(fallos > 0, vbCrLf & fallos & " con error (ver registro de iLogic)", ""), "INV3D")
End Sub
`;
