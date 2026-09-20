# A NATIVE stand-in for the game, for the chat-container work.
#
#   powershell -ExecutionPolicy Bypass -File tools/fakechat.ps1 [-Every 3000] [-Max 30]
#
# tools/fakedota.js holds chat STRINGS, which is all the scanner needed.
# It cannot hold a chat CONTAINER: node does not know the address of its
# own buffers, so nothing in it can point at anything. This one can. It
# compiles a small C# program to fakedota.exe (in the temp folder, never
# in the repo) and runs it, and that program keeps its chat the way a UI
# toolkit plausibly does:
#
#   panel  +0x00 "vtable" (an address inside kernel32, so it LOOKS like one)
#          +0x58 pointer to the children array   +0x60 count   +0x64 capacity
#   array  count pointers to labels; REALLOCATED when it grows, so its
#          address changes under the reader, as a growing vector's does
#   label  +0x00 "vtable"   +0x30 pointer back to the panel
#          +0x98 pointer to the text
#   text   the Panorama markup form of the line, UTF-8, null-terminated
#
# The oldest label is freed once there are -Max of them, as a chat panel
# drops its oldest line. THE LAYOUT IS INVENTED. It is here to prove the
# tools can find A container and read it; what Dota's looks like is for
# the live game to say.
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

# Cyrillic is written as escapes: Windows PowerShell reads a script with
# no BOM as ANSI, and the letters themselves would arrive as mojibake.
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class FakeChat {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string n);

  const int LABEL_SIZE = 0x120, LABEL_PARENT = 0x30, LABEL_TEXT = 0x98;
  const int PANEL_SIZE = 0x200, PANEL_KIDS = 0x58, PANEL_COUNT = 0x60, PANEL_CAP = 0x64;

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

  static string Markup(string tag, int slot, string name, string text) {
    return "<img src=\"file://{images}/heroes/icons/hero_juggernaut.png\" /><span class=\"ChatTarget\">" + tag +
      "<span class=\"ChatPersona\"><span class=\"PlayerColor" + slot + "\"><font color='#FF6B00'>" + name +
      "</font></span></span>: " + text;
  }

  public static int Main(string[] args) {
    int every = 3000, max = 30;
    for (int i = 0; i + 1 < args.Length; i++) {
      if (args[i] == "--every") every = int.Parse(args[i + 1]);
      if (args[i] == "--max") max = int.Parse(args[i + 1]);
    }

    IntPtr k32 = GetModuleHandle("kernel32.dll");
    IntPtr panel = Zeroed(PANEL_SIZE);
    Marshal.WriteIntPtr(panel, 0, (IntPtr)((long)k32 + 0x3000));
    int cap = 8, count = 0;
    IntPtr arr = Zeroed(cap * 8);
    Marshal.WriteIntPtr(panel, PANEL_KIDS, arr);
    Marshal.WriteInt32(panel, PANEL_CAP, cap);

    string[][] lines = {
      new[] { "1", "Иван", "иди мид" },
      new[] { "0", "Луиза", "я иду топ, помогите" },
      new[] { "1", "Pernille", "Pushing mid" },
      new[] { "1", "Иван", "давай рошан" },
      new[] { "0", "Луиза", "не фидите, у них варды на руне" },
      new[] { "1", "Иван", "гг вп" },
    };

    Console.WriteLine("[fakechat] pid " + System.Diagnostics.Process.GetCurrentProcess().Id +
      " panel=0x" + ((long)panel).ToString("x") + " kids=+0x58 count=+0x60 text=+0x98, a line every " + every + "ms, at most " + max);

    for (int n = 0; ; n++) {
      string[] l = lines[n % lines.Length];
      // A counter, because a reader dedups by content.
      IntPtr text = Utf8(Markup(l[0] == "1" ? "[Allies] " : "", 4, l[1], l[2] + " " + (n + 1)));
      IntPtr label = Zeroed(LABEL_SIZE);
      Marshal.WriteIntPtr(label, 0, (IntPtr)((long)k32 + 0x2000));
      Marshal.WriteIntPtr(label, LABEL_PARENT, panel);
      Marshal.WriteIntPtr(label, LABEL_TEXT, text);

      if (count == max) {
        IntPtr old = Marshal.ReadIntPtr(arr, 0);
        Marshal.FreeHGlobal(Marshal.ReadIntPtr(old, LABEL_TEXT));
        Marshal.FreeHGlobal(old);
        for (int i = 1; i < count; i++) Marshal.WriteIntPtr(arr, (i - 1) * 8, Marshal.ReadIntPtr(arr, i * 8));
        count--;
      }
      if (count == cap) {
        IntPtr bigger = Zeroed(cap * 2 * 8);
        for (int i = 0; i < count; i++) Marshal.WriteIntPtr(bigger, i * 8, Marshal.ReadIntPtr(arr, i * 8));
        Marshal.WriteIntPtr(panel, PANEL_KIDS, bigger);
        Marshal.FreeHGlobal(arr);
        arr = bigger; cap *= 2;
        Marshal.WriteInt32(panel, PANEL_CAP, cap);
      }
      Marshal.WriteIntPtr(arr, count * 8, label);
      count++;
      Marshal.WriteInt32(panel, PANEL_COUNT, count);

      Console.WriteLine("[said] #" + (n + 1) + " lines=" + count + " array=0x" + ((long)arr).ToString("x"));
      Thread.Sleep(every);
    }
  }
}
'@

if (Test-Path $exe) { Remove-Item -Force $exe }
Add-Type -TypeDefinition $src -OutputAssembly $exe -OutputType ConsoleApplication
& $exe --every $Every --max $Max
