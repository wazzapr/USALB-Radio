using System;
using System.Threading;
using System.Windows;

namespace USALB.Broadcaster;

public partial class App : Application
{
    private static Mutex? instanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        const string mutexName = @"Global\\USALB-Radio-Broadcaster-SingleInstance";

        instanceMutex = new Mutex(true, mutexName, out var createdNew);
        if (!createdNew)
        {
            MessageBox.Show(
                "USALB Broadcaster is already running.",
                "USALB Broadcaster",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown(0);
            return;
        }

        ShutdownMode = ShutdownMode.OnMainWindowClose;
        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { instanceMutex?.ReleaseMutex(); } catch { }
        instanceMutex?.Dispose();
        instanceMutex = null;
        base.OnExit(e);
    }
}
