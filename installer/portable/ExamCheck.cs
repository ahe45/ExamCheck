using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using System.Reflection;

[assembly: AssemblyTitle("가번호 관리 시스템")]
[assembly: AssemblyProduct("가번호 관리 시스템")]
[assembly: AssemblyDescription("가번호 관리 시스템 서버 실행 및 데이터 관리")]

internal static class ExamCheckLauncher
{
    private static string Quote(string value)
    {
        return "\"" + Regex.Replace(value, "(\\\\*)\"", "$1$1\\\"").TrimEnd('\\')
            + new string('\\', (value.Length - value.TrimEnd('\\').Length) * 2) + "\"";
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            bool firewall = args.Length == 1 && args[0] == "--configure-firewall";
            string script = Path.Combine(root, "runtime", firewall ? "firewall.ps1" : "launcher.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("실행에 필요한 파일이 없습니다. 설치 프로그램으로 다시 설치해 주세요.");
            string arguments = "-NoProfile -NonInteractive -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Quote(script);
            if (firewall) arguments += " -Elevated";
            else if (args.Length == 2 && args[0] == "--data-dir") arguments += " -DataDirectory " + Quote(args[1]);
            else if (args.Length != 0) throw new ArgumentException("지원하지 않는 실행 옵션입니다.");
            var info = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = arguments,
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var process = Process.Start(info))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "가번호 관리 시스템", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
