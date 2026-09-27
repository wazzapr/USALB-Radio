using System.Diagnostics;
using System.Text;
using System.Windows;
using System.Windows.Threading;

namespace USALB.Broadcaster;

public partial class DiagnosticsWindow : Window
{
    readonly Func<string> getLog;
    readonly Func<DiagnosticsSnapshot> getSnapshot;
    readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(1) };

    public DiagnosticsWindow(Func<string> getLog, Func<DiagnosticsSnapshot> getSnapshot)
    {
        InitializeComponent();
        this.getLog = getLog;
        this.getSnapshot = getSnapshot;
        timer.Tick += (_, _) => Refresh();
        Loaded += (_, _) => { Refresh(); timer.Start(); };
        Closed += (_, _) => timer.Stop();
    }

    void Refresh()
    {
        var snapshot = getSnapshot();
        ConnectionHealth.Text = snapshot.Connection;
        AudioHealth.Text = snapshot.AudioFlow;
        ReconnectCount.Text = snapshot.Reconnects.ToString();
        LiveUptime.Text = snapshot.Uptime;
        LogBox.Text = getLog();
        LogBox.CaretIndex = LogBox.Text.Length;
        LogBox.ScrollToEnd();
    }

    void CopyButton_Click(object sender, RoutedEventArgs e)
    {
        try { Clipboard.SetText(BuildReport()); } catch { }
    }

    void GitHubButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var title = $"Broadcaster diagnostic incident · {DateTime.Now:yyyy-MM-dd HH:mm:ss}";
            var body = BuildReport();
            var url = "https://github.com/wazzapr/USALB-Radio/issues/new?title=" +
                      Uri.EscapeDataString(title) + "&body=" + Uri.EscapeDataString(body);
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "USALB Diagnostics", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    string BuildReport()
    {
        var s = getSnapshot();
        var report = new StringBuilder();
        report.AppendLine("## USALB Broadcaster diagnostic incident");
        report.AppendLine($"Time: {DateTime.Now:O}");
        report.AppendLine($"Version: {GetType().Assembly.GetName().Version}");
        report.AppendLine();
        report.AppendLine("Connection: " + s.Connection);
        report.AppendLine("Audio flow: " + s.AudioFlow);
        report.AppendLine("Reconnects: " + s.Reconnects);
        report.AppendLine("Uptime: " + s.Uptime);
        report.AppendLine("Frames sent: " + s.FramesSent);
        report.AppendLine("Bytes sent: " + s.BytesSent.ToString("N0"));
        report.AppendLine();
        report.AppendLine("Important events:");
        report.AppendLine(GetImportantEvents());

        // Keep the GitHub issue URL comfortably below browser/server URL limits.
        var text = report.ToString();
        return text.Length <= 6000 ? text : text[^6000..];
    }

    string GetImportantEvents()
    {
        var lines = getLog()
            .Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)
            .Where(IsImportantDiagnostic)
            .TakeLast(40)
            .ToArray();

        if (lines.Length == 0)
            return "No errors, disconnects, reconnects, or server warnings recorded.";

        return string.Join(Environment.NewLine, lines);
    }

    static bool IsImportantDiagnostic(string line)
    {
        var text = line.ToUpperInvariant();

        // Deliberately exclude the repeating 3-second health/heartbeat spam.
        if (text.Contains("SERVER HEALTH:") || text.Contains("SERVER HEARTBEAT RECEIVED."))
            return false;

        return text.Contains("ERROR") ||
               text.Contains("DISCONNECT") ||
               text.Contains("DISCONNECTED") ||
               text.Contains("RECONNECT") ||
               text.Contains("FAILED") ||
               text.Contains("EXCEPTION") ||
               text.Contains("TIMEOUT") ||
               text.Contains("CLOSE CODE") ||
               text.Contains("CLOSE REASON") ||
               text.Contains("ABORT") ||
               text.Contains("WARNING") ||
               text.Contains("GO LIVE") ||
               text.Contains("READY") ||
               text.Contains("CONNECTION");
    }

    void CloseButton_Click(object sender, RoutedEventArgs e) => Close();
}

public sealed record DiagnosticsSnapshot(
    string Connection,
    string AudioFlow,
    int Reconnects,
    string Uptime,
    long FramesSent,
    long BytesSent
);