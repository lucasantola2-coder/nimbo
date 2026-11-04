// Nimbo - funciones nativas de Windows. Se compila al vuelo desde helper.ps1 (Windows PowerShell 5.1, C# 5).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;

public class NimboWin {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int idx);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint n);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int val, int size);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hWnd, int attr, ref int val, int size);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder s, ref int size);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHQueryRecycleBin(string root, ref SHQUERYRBINFO info);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHEmptyRecycleBin(IntPtr hwnd, string root, uint flags);
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out DIBSECTION ds);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

    // ---- COM: propiedades de ventanas y accesos directos, imágenes del shell ----
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr pbc, int flags, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory f);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out uint c);
        [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
        [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
        [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
        [PreserveSig] int Commit();
    }
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory {
        [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
    }
    [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public uint pid; public PROPERTYKEY(string g, uint p) { fmtid = new Guid(g); pid = p; } }
    [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
    [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }
    [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER { public uint biSize; public int biWidth, biHeight; public ushort biPlanes, biBitCount; public uint biCompression, biSizeImage; public int biXPelsPerMeter, biYPelsPerMeter; public uint biClrUsed, biClrImportant; }
    [StructLayout(LayoutKind.Sequential)] struct DIBSECTION { public BITMAP dsBm; public BITMAPINFOHEADER dsBmih; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)] public uint[] dsBitfields; public IntPtr dshSection; public uint dsOffset; }

    static Guid IID_IPropertyStore = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    static Guid IID_IShellItemImageFactory = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    const string AUM = "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3";
    static PROPERTYKEY PK_RelaunchCommand = new PROPERTYKEY(AUM, 2);
    static PROPERTYKEY PK_RelaunchIcon = new PROPERTYKEY(AUM, 3);
    static PROPERTYKEY PK_RelaunchName = new PROPERTYKEY(AUM, 4);
    static PROPERTYKEY PK_AppId = new PROPERTYKEY(AUM, 5);
    static PROPERTYKEY PK_LinkTarget = new PROPERTYKEY("B9B4B3FC-2B51-4A42-B5D8-324146AFCF25", 2);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] public struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint msg; public uint edge; public RECT rc; public IntPtr lParam; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] public struct SHQUERYRBINFO { public int cbSize; public long i64Size; public long i64NumItems; }

    static string ReadString(IPropertyStore ps, PROPERTYKEY key) {
        PROPVARIANT v;
        if (ps.GetValue(ref key, out v) != 0) return "";
        string r = "";
        try {
            if (v.vt == 31 && v.p != IntPtr.Zero) r = Marshal.PtrToStringUni(v.p);       // VT_LPWSTR
            else if (v.vt == 8 && v.p != IntPtr.Zero) r = Marshal.PtrToStringBSTR(v.p);  // VT_BSTR
        } finally { PropVariantClear(ref v); }
        return r ?? "";
    }

    // ---- Ventanas ----
    public class WinInfo {
        public long hwnd; public string title; public uint pid; public string exe; public bool active; public bool minimized;
        public string aumid; public string relaunchCmd; public string relaunchIcon; public string relaunchName;
    }

    static string ExeOf(uint pid) {
        IntPtr h = OpenProcess(0x1000, false, pid);
        if (h == IntPtr.Zero) return "";
        try { var sb = new StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : ""; }
        finally { CloseHandle(h); }
    }

    static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }

    static void FillWindowProps(IntPtr h, WinInfo w) {
        w.aumid = ""; w.relaunchCmd = ""; w.relaunchIcon = ""; w.relaunchName = "";
        IPropertyStore ps = null;
        try {
            if (SHGetPropertyStoreForWindow(h, ref IID_IPropertyStore, out ps) != 0 || ps == null) return;
            w.aumid = ReadString(ps, PK_AppId);
            w.relaunchCmd = ReadString(ps, PK_RelaunchCommand);
            w.relaunchIcon = ReadString(ps, PK_RelaunchIcon);
            w.relaunchName = ReadString(ps, PK_RelaunchName);
        } catch { } finally { if (ps != null) Marshal.ReleaseComObject(ps); }
    }

    public static List<WinInfo> ListWindows(long selfPid) {
        var list = new List<WinInfo>();
        IntPtr fg = GetForegroundWindow();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            int ex = GetWindowLong(h, -20);
            bool appWindow = (ex & 0x40000) != 0;                        // WS_EX_APPWINDOW
            if (GetWindow(h, 4) != IntPtr.Zero && !appWindow) return true; // tiene propietario
            if ((ex & 0x80) != 0 && !appWindow) return true;            // WS_EX_TOOLWINDOW
            if ((ex & 0x08000000) != 0 && !appWindow) return true;      // WS_EX_NOACTIVATE
            int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);   // DWMWA_CLOAKED
            if (cloaked != 0) return true;
            int len = GetWindowTextLength(h);
            if (len == 0) return true;
            string cls = ClassOf(h);
            if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
            var sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity);
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == selfPid) return true;
            var w = new WinInfo { hwnd = h.ToInt64(), title = sb.ToString(), pid = pid, exe = ExeOf(pid), active = h == fg, minimized = IsIconic(h) };
            FillWindowProps(h, w);
            list.Add(w);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    // ---- Accesos directos (.lnk): id de app y destino ----
    public class LinkInfo { public string path; public string aumid; public string target; }
    public static LinkInfo Link(string path) {
        var r = new LinkInfo { path = path, aumid = "", target = "" };
        IPropertyStore ps = null;
        try {
            if (SHGetPropertyStoreFromParsingName(path, IntPtr.Zero, 0x40, ref IID_IPropertyStore, out ps) != 0 || ps == null) return r;  // GPS_BESTEFFORT
            r.aumid = ReadString(ps, PK_AppId);
            r.target = ReadString(ps, PK_LinkTarget);
        } catch { } finally { if (ps != null) Marshal.ReleaseComObject(ps); }
        return r;
    }

    // ---- Íconos como PNG en base64 (igual que los dibuja el Explorador) ----
    // path puede ser un .exe, .lnk, .ico, "archivo,índice" o "shell:AppsFolder\<id de app>"
    public static string Icon(string path, int size) {
        try {
            int comma = path.LastIndexOf(',');
            if (comma > 2 && !path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)) {
                int idx;
                string file = path.Substring(0, comma).Trim().Trim('"').TrimStart('@');
                if (int.TryParse(path.Substring(comma + 1).Trim(), out idx)) {
                    string fromRes = IconFromResource(Environment.ExpandEnvironmentVariables(file), idx);
                    if (fromRes != null) return fromRes;
                    path = file;
                }
            }
            path = Environment.ExpandEnvironmentVariables(path.Trim('"'));
            IShellItemImageFactory f = null;
            if (SHCreateItemFromParsingName(path, IntPtr.Zero, ref IID_IShellItemImageFactory, out f) != 0 || f == null) return null;
            try {
                IntPtr hbm;
                var sz = new SIZE { cx = size, cy = size };
                if (f.GetImage(sz, 0x4 | 0x1, out hbm) != 0 || hbm == IntPtr.Zero) return null;   // ICONONLY | BIGGERSIZEOK
                try { return HBitmapToPng(hbm); } finally { DeleteObject(hbm); }
            } finally { Marshal.ReleaseComObject(f); }
        } catch { return null; }
    }

    static string IconFromResource(string file, int index) {
        if (!File.Exists(file)) return null;
        var large = new IntPtr[1];
        if (ExtractIconEx(file, index, large, null, 1) == 0 || large[0] == IntPtr.Zero) return null;
        try {
            using (var ico = System.Drawing.Icon.FromHandle(large[0]))
            using (var bmp = ico.ToBitmap())
            using (var ms = new MemoryStream()) { bmp.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
        } finally { DestroyIcon(large[0]); }
    }

    static string HBitmapToPng(IntPtr hbm) {
        DIBSECTION ds;
        if (GetObject(hbm, Marshal.SizeOf(typeof(DIBSECTION)), out ds) == 0) return null;
        int w = ds.dsBm.bmWidth, h = ds.dsBm.bmHeight;
        if (w <= 0 || h <= 0) return null;
        Bitmap bmp;
        if (ds.dsBm.bmBitsPixel == 32 && ds.dsBm.bmBits != IntPtr.Zero) {
            int stride = ds.dsBm.bmWidthBytes;
            var px = new byte[stride * h];
            Marshal.Copy(ds.dsBm.bmBits, px, 0, px.Length);
            bool topDown = ds.dsBmih.biHeight < 0;
            bool anyAlpha = false;
            for (int i = 3; i < px.Length; i += 4) if (px[i] != 0) { anyAlpha = true; break; }
            bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            var row = new byte[w * 4];
            for (int y = 0; y < h; y++) {
                int src = (topDown ? y : h - 1 - y) * stride;
                for (int x = 0; x < w; x++) {
                    int o = src + x * 4;
                    byte b = px[o], g = px[o + 1], r = px[o + 2], a = anyAlpha ? px[o + 3] : (byte)255;
                    if (a > 0 && a < 255) { b = (byte)Math.Min(255, b * 255 / a); g = (byte)Math.Min(255, g * 255 / a); r = (byte)Math.Min(255, r * 255 / a); } // quitar alfa premultiplicado
                    row[x * 4] = b; row[x * 4 + 1] = g; row[x * 4 + 2] = r; row[x * 4 + 3] = a;
                }
                Marshal.Copy(row, 0, new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), row.Length);
            }
            bmp.UnlockBits(data);
        } else {
            bmp = Image.FromHbitmap(hbm);
        }
        using (bmp)
        using (var ms = new MemoryStream()) { bmp.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
    }

    // ---- Pantalla completa ----
    // Ventanas del propio Windows que a veces quedan "al frente" ocupando toda la pantalla sin verse
    static readonly HashSet<string> ShellClasses = new HashSet<string> {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
        "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland", "ForegroundStaging",
        "MultitaskingViewFrame", "TaskSwitcherWnd", "NotifyIconOverflowWindow", "Shell_InputSwitchTopLevelWindow"
    };
    static readonly HashSet<string> ShellExes = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "explorer.exe", "SearchHost.exe", "SearchApp.exe", "StartMenuExperienceHost.exe", "ShellExperienceHost.exe",
        "TextInputHost.exe", "LockApp.exe", "ShellHost.exe", "Widgets.exe", "WidgetBoard.exe"
    };

    // Devuelve una descripción de la ventana si de verdad hay algo a pantalla completa; si no, null
    public static string FullscreenApp(long selfPid) {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero || !IsWindowVisible(fg) || IsIconic(fg)) return null;
        string cls = ClassOf(fg);
        if (ShellClasses.Contains(cls)) return null;
        int cloaked; DwmGetWindowAttribute(fg, 14, out cloaked, 4);
        if (cloaked != 0) return null;
        uint pid; GetWindowThreadProcessId(fg, out pid);
        if (pid == selfPid) return null;
        string exe = Path.GetFileName(ExeOf(pid));
        if (ShellExes.Contains(exe)) return null;
        int style = GetWindowLong(fg, -16);
        if ((style & 0x00C00000) == 0x00C00000) return null;     // tiene barra de título (ventana normal o maximizada)
        RECT r; if (!GetWindowRect(fg, out r)) return null;
        var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(mi);
        if (!GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi)) return null;
        bool full = r.L == mi.rcMonitor.L && r.T == mi.rcMonitor.T && r.R == mi.rcMonitor.R && r.B == mi.rcMonitor.B;
        return full ? exe + " (" + cls + ")" : null;
    }

    // ---- Acciones sobre ventanas ----
    public static void Focus(long hwnd) {
        IntPtr h = new IntPtr(hwnd);
        if (IsIconic(h)) ShowWindow(h, 9);
        uint dummy;
        uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
        uint me = GetCurrentThreadId();
        // Truco ALT para que Windows permita cambiar el primer plano
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        AttachThreadInput(me, fgThread, true);
        SetForegroundWindow(h);
        AttachThreadInput(me, fgThread, false);
    }
    public static void Minimize(long hwnd) { ShowWindow(new IntPtr(hwnd), 6); }
    public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }

    // Combinación de teclas, p. ej. Win + A: se presionan en orden y se sueltan al revés
    public static void Keys(byte[] vks) {
        foreach (var k in vks) keybd_event(k, 0, 0, UIntPtr.Zero);
        for (int i = vks.Length - 1; i >= 0; i--) keybd_event(vks[i], 0, 2, UIntPtr.Zero);
    }
    public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }

    public static void RoundCorners(long hwnd) { int pref = 2; DwmSetWindowAttribute(new IntPtr(hwnd), 33, ref pref, 4); }

    // ---- Barra de tareas ----
    static int originalState = -1;
    public static int GetTaskbarState() { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); return (int)SHAppBarMessage(4, ref d).ToUInt32(); }
    public static void SetTaskbarAutoHide(bool on) {
        if (originalState < 0) originalState = GetTaskbarState();
        var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d);
        d.hWnd = FindWindow("Shell_TrayWnd", null);
        int st = GetTaskbarState();
        d.lParam = new IntPtr(on ? (st | 1) : (st & ~1));
        SHAppBarMessage(10, ref d);
    }
    public static void SetTaskbarVisible(bool visible) {
        int cmd = visible ? 5 : 0;
        ShowWindow(FindWindow("Shell_TrayWnd", null), cmd);
        EnumWindows((h, l) => { if (ClassOf(h) == "Shell_SecondaryTrayWnd") ShowWindow(h, cmd); return true; }, IntPtr.Zero);
    }
    public static void RestoreTaskbar() {
        SetTaskbarVisible(true);
        if (originalState >= 0) {
            var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d);
            d.hWnd = FindWindow("Shell_TrayWnd", null);
            d.lParam = new IntPtr(originalState);
            SHAppBarMessage(10, ref d);
        }
    }

    // ---- Papelera ----
    public static long[] RecycleBin() { var i = new SHQUERYRBINFO(); i.cbSize = Marshal.SizeOf(i); SHQueryRecycleBin(null, ref i); return new long[] { i.i64NumItems, i.i64Size }; }
    public static void EmptyRecycleBin() { SHEmptyRecycleBin(IntPtr.Zero, null, 0x7); }

    // ---- Discos y red ----
    public class DriveRow { public string name; public string label; public long total; public long free; }
    public static List<DriveRow> Drives() {
        var r = new List<DriveRow>();
        foreach (var d in DriveInfo.GetDrives()) {
            try { if (d.IsReady && d.DriveType == DriveType.Fixed) r.Add(new DriveRow { name = d.Name, label = d.VolumeLabel, total = d.TotalSize, free = d.AvailableFreeSpace }); } catch {}
        }
        return r;
    }
    public static long[] NetBytes() {
        long rx = 0, tx = 0;
        foreach (var n in NetworkInterface.GetAllNetworkInterfaces()) {
            if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            try { var s = n.GetIPStatistics(); rx += s.BytesReceived; tx += s.BytesSent; } catch {}
        }
        return new long[] { rx, tx };
    }
}
