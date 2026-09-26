using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;

using System.Diagnostics;
using System.IO.Compression;

if (args.Length < 8)
{
    Console.Error.WriteLine("Invalid updater arguments.");
    return 2;
}

string GetArg(string name)
{
    var index = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : "";
}

if (!int.TryParse(GetArg("--pid"), out var pid))
    return 2;

var zip = GetArg("--zip");
var target = GetArg("--target");
var exe = GetArg("--exe");
var updaterName = Path.GetFileName(Environment.ProcessPath ?? "USALB.Broadcaster.Updater.exe");

if (!File.Exists(zip) || !Directory.Exists(target) || !File.Exists(exe))
    return 2;

try
{
    try
    {
        using var old = Process.GetProcessById(pid);
        if (!old.HasExited)
            old.WaitForExit(30_000);
    }
    catch (ArgumentException)
    {
        // The broadcaster already exited.
    }

    var staging = Path.Combine(Path.GetTempPath(), "USALB-Broadcaster-update-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(staging);

    ZipFile.ExtractToDirectory(zip, staging);

    foreach (var source in Directory.EnumerateFiles(staging, "*", SearchOption.AllDirectories))
    {
        var relative = Path.GetRelativePath(staging, source);
        if (string.Equals(Path.GetFileName(relative), updaterName, StringComparison.OrdinalIgnoreCase))
            continue;

        var destination = Path.Combine(target, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Copy(source, destination, true);
    }

    var cleanup = Path.Combine(Path.GetTempPath(), "USALB-Broadcaster-update-" + Guid.NewGuid().ToString("N") + ".cmd");
    var stagedUpdater = Path.Combine(staging, updaterName);
    var targetUpdater = Path.Combine(target, updaterName);
    var script = $"""
@echo off
timeout /t 2 /nobreak >nul
copy /Y "{stagedUpdater}" "{targetUpdater}" >nul
rmdir /S /Q "{staging}" >nul 2>&1
del /Q "{zip}" >nul 2>&1
del "%~f0"
""";
    File.WriteAllText(cleanup, script);

    Process.Start(new ProcessStartInfo
    {
        FileName = exe,
        WorkingDirectory = target,
        UseShellExecute = true
    });

    Process.Start(new ProcessStartInfo
    {
        FileName = cleanup,
        WindowStyle = ProcessWindowStyle.Hidden,
        CreateNoWindow = true,
        UseShellExecute = true
    });

    return 0;
}
catch (Exception ex)
{
    File.WriteAllText(Path.Combine(Path.GetTempPath(), "USALB-Broadcaster-update-error.txt"), ex.ToString());
    return 1;
}
