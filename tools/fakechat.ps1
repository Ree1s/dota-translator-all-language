# A NATIVE stand-in for the game, for the chat-container work.
#
#   powershell -ExecutionPolicy Bypass -File tools/fakechat.ps1 [-Every 3000] [-Max 30]
#
# tools/fakedota.js holds chat STRINGS, which is all the scanner needed.
# It cannot hold a chat CONTAINER: node does not know the address of its
# own buffers, so nothing in it can point at anything. This one can. It
# compiles a small C# program to fakedota.exe (in the temp folder, never
# in the repo) and runs it, and that program keeps its chat the way Dota
# was MEASURED to (2026-09-20, see CLAUDE.md):
#
#   UI panel      +0x00 vtable   +0x08 -> client panel   +0x10 -> id string
#                 +0x18 -> parent UI panel
#                 +0x28 child count   +0x30 -> children array   +0x38 capacity
#   client panel  +0x00 vtable   +0x90 -> text object
#   text object   +0x00 vtable   +0x10 -> the line, UTF-8, null-terminated
#
# The chat is the UI panel whose id is "ChatLinesPanel"; its children are
# the lines, in order. As in the game, its FIRST child is not a chat line.
# The array is reallocated when it grows, and the oldest line is freed at
# -Max - the second of which is a GUESS about Dota, not a measurement.
# "vtables" are addresses inside kernel32, so that they look like one.
#
# A line's text is set a moment AFTER its panel joins the array, because
# a reader that only works when the two happen at once has not been
# tested.
#
# It prints the panel's address, so a test can check what the tools found
# against what is true.

param(
  [int]$Every = 3000,
  [int]$Max = 30,
  [string]$OutDir = (Join-Path $env:TEMP 'dt-fakechat')
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$exe = Join-Path $OutDir 'fakedota.exe'

# Cyrillic is written as hex code points, see U() below.
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FakeChat {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string n);

  const int UI_SIZE = 0x300, UI_CLIENT = 0x08, UI_ID = 0x10, UI_PARENT = 0x18, UI_COUNT = 0x28, UI_KIDS = 0x30, UI_CAP = 0x38;
  const int CLIENT_SIZE = 0x200, CLIENT_TEXT = 0x90, TEXT_SIZE = 0x40, TEXT_STR = 0x10;
  static long VT_UI, VT_CLIENT, VT_TEXT;

  // Text as hex code points. NOT as letters and NOT as C# escapes: this
  // file has no BOM, so Windows PowerShell reads it as ANSI and letters
  // arrive as mojibake - and an escape typed into an editor that decodes
  // escapes IS a letter by the time it is saved. That happened: the
  // stand-in said double-encoded Russian and the reader, rightly, did not
  // think it was Russian.
  static string U(string hex) {
    var sb = new StringBuilder();
    foreach (string h in hex.Split(' ')) sb.Append((char)Convert.ToInt32(h, 16));
    return sb.ToString();
  }

  static IntPtr Zeroed(int n) {
    IntPtr p = Marshal.AllocHGlobal(n);
    for (int i = 0; i < n; i++) Marshal.WriteByte(p, i, 0);
    return p;
  }

  static IntPtr Utf8(string s) {
    byte[] b = Encoding.UTF8.GetBytes(s);
    IntPtr p = Marshal.AllocHGlobal(b.Length + 1);
    Marshal.Copy(b, 0, p, b.Length);
    Marshal.WriteByte(p, b.Length, 0);
    return p;
  }

  static IntPtr UiPanel(IntPtr parent, string id) {
    IntPtr ui = Zeroed(UI_SIZE), client = Zeroed(CLIENT_SIZE);
    Marshal.WriteInt64(ui, 0, VT_UI);
    Marshal.WriteIntPtr(ui, UI_CLIENT, client);
    if (id != null) Marshal.WriteIntPtr(ui, UI_ID, Utf8(id));
    Marshal.WriteIntPtr(ui, UI_PARENT, parent);
    Marshal.WriteInt64(client, 0, VT_CLIENT);
    return ui;
  }

  static void SetText(IntPtr ui, string s) {
    IntPtr text = Zeroed(TEXT_SIZE);
    Marshal.WriteInt64(text, 0, VT_TEXT);
    Marshal.WriteIntPtr(text, TEXT_STR, Utf8(s));
    Marshal.WriteIntPtr(Marshal.ReadIntPtr(ui, UI_CLIENT), CLIENT_TEXT, text);
  }

  static void FreePanel(IntPtr ui) {
    IntPtr client = Marshal.ReadIntPtr(ui, UI_CLIENT), text = Marshal.ReadIntPtr(client, CLIENT_TEXT);
    if (text != IntPtr.Zero) { Marshal.FreeHGlobal(Marshal.ReadIntPtr(text, TEXT_STR)); Marshal.FreeHGlobal(text); }
    Marshal.FreeHGlobal(client); Marshal.FreeHGlobal(ui);
  }

  static string Markup(bool team, string name, string text) {
    return "<span class=\"" + (team ? "GameAlliesChat" : "GameAllChat") + " Received Visitor\"><panel class=\"HeroBadge\" />" +
      "<img class=\"HeroIcon\" src=\"file://{images}/heroes/npc_dota_hero_furion.png\" /><span class=\"ChatTarget\">" +
      (team ? "[Allies] " : " ") + "<span class=\"ChatPersona\"><span class=\"PlayerColor4\"><font color='#FF6B00'>" + name +
      "</font></span></span></span>: " + text + "</span>";
  }

  public static int Main(string[] args) {
    int every = 3000, max = 30;
    for (int i = 0; i + 1 < args.Length; i++) {
      if (args[i] == "--every") every = int.Parse(args[i + 1]);
      if (args[i] == "--max") max = int.Parse(args[i + 1]);
    }

    long k32 = (long)GetModuleHandle("kernel32.dll");
    VT_UI = k32 + 0x3000; VT_CLIENT = k32 + 0x2000; VT_TEXT = k32 + 0x1000;

    IntPtr hud = UiPanel(IntPtr.Zero, "DotaHud");
    IntPtr panel = UiPanel(hud, "ChatLinesPanel");
    int cap = 4, count = 0;
    IntPtr arr = Zeroed(cap * 8);
    Marshal.WriteIntPtr(panel, UI_KIDS, arr);
    Marshal.WriteInt32(panel, UI_CAP, cap);

    // As in the game: the first child is something that is not a line.
    IntPtr header = UiPanel(panel, null);
    SetText(header, "<span class=\"ChatHeader\">not a chat line</span>");
    Marshal.WriteIntPtr(arr, 0, header); count = 1;
    Marshal.WriteInt32(panel, UI_COUNT, count);

    string[][] lines = {
      new[] { "1", U("0418 0432 0430 043d"), U("0438 0434 0438 0020 043c 0438 0434") },
      new[] { "0", U("041b 0443 0438 0437 0430"), U("044f 0020 0438 0434 0443 0020 0442 043e 043f 002c 0020 043f 043e 043c 043e 0433 0438 0442 0435") },
      new[] { "1", "Pernille", "Pushing mid" },
      new[] { "1", U("0418 0432 0430 043d"), U("0434 0430 0432 0430 0439 0020 0440 043e 0448 0430 043d") },
      new[] { "0", U("041b 0443 0438 0437 0430"), U("043d 0435 0020 0444 0438 0434 0438 0442 0435 002c 0020 0443 0020 043d 0438 0445 0020 0432 0430 0440 0434 044b 0020 043d 0430 0020 0440 0443 043d 0435") },
      new[] { "1", U("0418 0432 0430 043d"), U("0433 0433 0020 0432 043f") },
    };

    Console.WriteLine("[fakechat] pid " + System.Diagnostics.Process.GetCurrentProcess().Id +
      " panel=0x" + ((long)panel).ToString("x") + ", a line every " + every + "ms, at most " + max);

    for (int n = 0; ; n++) {
      string[] l = lines[n % lines.Length];
      IntPtr ui = UiPanel(panel, null);

      if (count == max) {
        // The oldest LINE goes; the header stays where it is.
        FreePanel(Marshal.ReadIntPtr(arr, 8));
        for (int i = 2; i < count; i++) Marshal.WriteIntPtr(arr, (i - 1) * 8, Marshal.ReadIntPtr(arr, i * 8));
        count--;
      }
      if (count == cap) {
        IntPtr bigger = Zeroed(cap * 2 * 8);
        for (int i = 0; i < count; i++) Marshal.WriteIntPtr(bigger, i * 8, Marshal.ReadIntPtr(arr, i * 8));
        Marshal.WriteIntPtr(panel, UI_KIDS, bigger);
        Marshal.FreeHGlobal(arr);
        arr = bigger; cap *= 2;
        Marshal.WriteInt32(panel, UI_CAP, cap);
      }
      Marshal.WriteIntPtr(arr, count * 8, ui);
      count++;
      Marshal.WriteInt32(panel, UI_COUNT, count);

      Thread.Sleep(120);
      // A counter, because a reader dedups by content.
      SetText(ui, Markup(l[0] == "1", l[1], l[2] + " " + (n + 1)));

      Console.WriteLine("[said] #" + (n + 1) + " " + DateTime.Now.ToString("HH:mm:ss.fff") + " children=" + count);
      Thread.Sleep(every);
    }
  }
}
'@

if (Test-Path $exe) { Remove-Item -Force $exe }
Add-Type -TypeDefinition $src -OutputAssembly $exe -OutputType ConsoleApplication
& $exe --every $Every --max $Max
