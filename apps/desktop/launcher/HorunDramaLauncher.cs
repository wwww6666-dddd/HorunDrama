// HorunDrama · 启动器
//
// 为什么需要它：这台机器上 Electron 不带 --no-sandbox 会在原生初始化阶段直接崩
// （退出码 0x80000003，且崩在主进程 JS 之前，程序内无法自救）。
// 而「双击 exe」这个动作没法带参数，所以把真正的 Electron 程序改名为 HorunDramaCore.exe，
// 用一个极小的 launcher 顶替 YiMu.exe：它只做一件事——带上 --no-sandbox 再拉起核心程序。
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

        var sb = new StringBuilder("--no-sandbox ");
        foreach (string a in args)
        {
            sb.Append('"').Append(a.Replace("\"", "\\\"")).Append("\" ");
        }

        var psi = new ProcessStartInfo(core, sb.ToString())
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(core) ?? dir,
            CreateNoWindow = true,
        };
        Process.Start(psi);
        return 0;
    }
}
