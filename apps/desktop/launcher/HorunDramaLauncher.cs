// HorunDrama · 启动器
//
// 双击 exe 时先用 Chromium 沙箱启动 Electron；若它在 6 秒内异常退出，
// 再启用 --no-sandbox --disable-gpu 兼容模式，兼顾安全默认值和受限环境兼容性。
//
// 编译：csc /target:winexe /out:YiMu.exe YiMuLauncher.cs
// （.NET Framework 4.x 自带编译器，目标机器无需安装运行时）
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".";
        // 核心程序在 app\ 子目录里（根目录只留这一个启动器，用户不会点错）
        string core = Path.Combine(dir, "app", "HorunDramaCore.exe");
        if (!File.Exists(core)) core = Path.Combine(dir, "HorunDramaCore.exe");
        if (!File.Exists(core))
        {
            string alt = Path.Combine(dir, "HorunDrama.exe");
            if (File.Exists(alt) && !string.Equals(alt, Assembly.GetExecutingAssembly().Location, StringComparison.OrdinalIgnoreCase))
            {
                core = alt;
            }
            else
            {
                return 3;
            }
        }

        using (Process first = StartCore(core, args, false))
        {
            if (first == null) return 4;
            if (!first.WaitForExit(6000)) return 0;
            if (first.ExitCode == 0) return 0;
        }

        using (Process fallback = StartCore(core, args, true))
        {
            return fallback == null ? 4 : 0;
        }
    }

    private static Process StartCore(string core, string[] args, bool compatibilityMode)
    {
        var sb = new StringBuilder();
        if (compatibilityMode) sb.Append("--no-sandbox --disable-gpu ");
        foreach (string a in args)
        {
            sb.Append('"').Append(a.Replace("\"", "\\\"")).Append("\" ");
        }

        var psi = new ProcessStartInfo(core, sb.ToString())
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(core) ?? ".",
            CreateNoWindow = true,
        };
        return Process.Start(psi);
    }
}
