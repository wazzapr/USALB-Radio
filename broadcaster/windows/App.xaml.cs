using System;
using System.IO;
using System.Threading;
using System.Windows;

namespace USALB.Broadcaster;

public partial class App : Application
{
    private static Mutex? instanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        const string mutexName = @"Global\USALB-Radio-Broadcaster-SingleInstance";
        instanceMutex = new Mutex(true, mutexName, out var createdNew);
        if (!createdNew)
        {
            MessageBox.Show("USALB Broadcaster is already running.", "USALB Broadcaster", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown(0);
            return;
        }

        ShutdownMode = ShutdownMode.OnMainWindowClose;
        try
        {
            base.OnStartup(e);
            var window = new MainWindow();
            MainWindow = window;
            window.Show();
        }
        catch (Exception ex)
        {
            ShowStartupError(ex);
            Shutdown(1);
        }
    }

    private static void ShowStartupError(Exception ex)
    {
        try
        {
            var log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "USALB", "Broadcaster");
            Directory.CreateDirectory(log);
            File.WriteAllText(Path.Combine(log, "startup-error.log"), $"{DateTime.Now:O}\n{ex}\n");
        }
        catch { }

        MessageBox.Show(
            $"USALB Broadcaster could not start.\n\n{ex.Message}\n\nA diagnostic log was saved in:\n%LOCALAPPDATA%\\USALB\\Broadcaster\\startup-error.log",
            "USALB Broadcaster — Startup Error",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { instanceMutex?.ReleaseMutex(); } catch { }
        instanceMutex?.Dispose();
        instanceMutex = null;
        base.OnExit(e);
    }
}