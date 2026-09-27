import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import Darwin

// System-level event tap consumes only Esc in the matching foreground game.
// No game hooks or process memory; simulation requires an explicit stdin command.
func option(_ name: String, _ fallback: String = "") -> String {
    guard let i = CommandLine.arguments.firstIndex(of: name), i + 1 < CommandLine.arguments.count else { return fallback }
    return CommandLine.arguments[i + 1]
}
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
    print(line); fflush(stdout)
}
let mode = option("--mode", "discover")
let processName = option("--process", "Warcraft III")
let bundleID = option("--bundle")
let parent = Int32(option("--parent", "0")) ?? 0
let copyModifier: CGEventFlags = option("--copy-modifier", "command") == "control" ? .maskControl : .maskCommand
let selection = option("--selection", "end-home")
func matches(_ app: NSRunningApplication) -> Bool {
    if !bundleID.isEmpty { return app.bundleIdentifier == bundleID }
    return app.executableURL?.lastPathComponent.caseInsensitiveCompare(processName) == .orderedSame
}
func owner() -> pid_t? {
    guard let front = NSWorkspace.shared.frontmostApplication, matches(front) else { return nil }
    return front.processIdentifier
}
func front(_ pid: pid_t) -> Bool { return owner() == pid }
func held(_ code: CGKeyCode) -> Bool { CGEventSource.keyState(.combinedSessionState, key: code) }
func shift() -> Bool { held(56) || held(60) }
func forbiddenModifier() -> Bool { [54,55,58,61,59,62].contains { held(CGKeyCode($0)) } }
func permissions() -> [String: Any] {
    return ["t": "permissions", "accessibility": AXIsProcessTrusted(), "inputMonitoring": CGPreflightListenEventAccess()]
}
if mode == "permissions" {
    if CommandLine.arguments.contains("--request") {
        let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(prompt)
        _ = CGRequestListenEventAccess()
    }
    emit(permissions()); exit(0)
}
if mode == "discover" {
    let apps = NSWorkspace.shared.runningApplications.filter { matches($0) }
    let processes: [[String: Any]] = apps.map { ["name": $0.executableURL?.lastPathComponent ?? "", "pid": $0.processIdentifier, "path": $0.executableURL?.path ?? "", "bundleId": $0.bundleIdentifier ?? ""] }
    var roots = [FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Blizzard/Warcraft III").path,
                 FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Warcraft III").path]
    roots += apps.compactMap { $0.bundleURL?.deletingLastPathComponent().path }
    emit(["processes": processes, "roots": Array(Set(roots)).filter { FileManager.default.fileExists(atPath: $0) }]); exit(0)
}
final class EscapeWatch {
    var tap: CFMachPort?
    var armedPID: pid_t?
    var shifted = false
    var cancelled = false
    func reset() { armedPID = nil; shifted = false; cancelled = false }
    func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        if type == .tapDisabledByTimeout {
            reset()
            if let port = tap { CGEvent.tapEnable(tap: port, enable: true) }
            emit(["t":"status", "text":"Mac hotkey listener recovered after timeout"])
            return Unmanaged.passUnretained(event)
        }
        if type == .tapDisabledByUserInput { reset(); return Unmanaged.passUnretained(event) }
        guard let current = owner(), AXIsProcessTrusted(), CGPreflightListenEventAccess() else {
            reset(); return Unmanaged.passUnretained(event)
        }
        if let armed = armedPID, armed != current { reset() }
        let extra = !event.flags.intersection([.maskCommand, .maskControl, .maskAlternate]).isEmpty
        if type == .flagsChanged {
            if armedPID != nil { shifted = shifted || event.flags.contains(.maskShift); cancelled = cancelled || extra }
            return Unmanaged.passUnretained(event)
        }
        guard event.getIntegerValueField(.keyboardEventKeycode) == 53 else { return Unmanaged.passUnretained(event) }
        if type == .keyDown {
            if armedPID == nil {
                if extra || event.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return Unmanaged.passUnretained(event) }
                armedPID = current; shifted = event.flags.contains(.maskShift); cancelled = false
            }
            return nil // prevent Esc from closing the Warcraft input before copying
        }
        if type == .keyUp, armedPID == current {
            shifted = shifted || event.flags.contains(.maskShift)
            if !cancelled && !extra { emit(["t":"hotkey", "key": shifted ? "Shift+Escape" : "Escape"]) }
            reset()
            return nil
        }
        return Unmanaged.passUnretained(event)
    }
}
func escapeCallback(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent, _ info: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    guard let info = info else { return Unmanaged.passUnretained(event) }
    return Unmanaged<EscapeWatch>.fromOpaque(info).takeUnretainedValue().handle(type, event)
}
if mode == "watch" {
    let state = EscapeWatch()
    var lastOwner: pid_t? = nil
    var lastFocus: Bool? = nil
    var lastPermissions = ""
    var retryAt = Date.distantPast
    let enabled = option("--hotkeys", "true") != "false"
    while parent == 0 || getppid() == parent {
        let allowed = AXIsProcessTrusted() && CGPreflightListenEventAccess()
        let permissionKey = "\(AXIsProcessTrusted())/\(CGPreflightListenEventAccess())"
        if permissionKey != lastPermissions { emit(permissions()); lastPermissions = permissionKey }
        let current = owner()
        let active = current != nil
        if lastFocus != active { emit(["t":"focus", "on": active ? 1 : 0]); lastFocus = active }
        if current != lastOwner { state.reset(); lastOwner = current }
        if allowed && enabled && state.tap == nil && Date() >= retryAt {
            let mask = (CGEventMask(1) << CGEventType.keyDown.rawValue) | (CGEventMask(1) << CGEventType.keyUp.rawValue) | (CGEventMask(1) << CGEventType.flagsChanged.rawValue)
            if let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: escapeCallback, userInfo: Unmanaged.passUnretained(state).toOpaque()) {
                state.tap = port
                let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
                CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
                CGEvent.tapEnable(tap: port, enable: true)
                emit(["t":"status", "text":"Mac Esc / Shift+Esc listener ready (English only)"])
            } else {
                emit(["t":"status", "text":"Cannot create Mac Esc listener; check Accessibility and Input Monitoring"])
                retryAt = Date(timeIntervalSinceNow: 5)
            }
        }
        if !allowed { state.reset() }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.04))
    }
    if let port = state.tap { CFMachPortInvalidate(port) }
    exit(0)
}

let eventSource = CGEventSource(stateID: .privateState)
func tap(_ code: CGKeyCode, _ flags: CGEventFlags, _ pid: pid_t) -> Bool {
    guard AXIsProcessTrusted(), front(pid),
          let down = CGEvent(keyboardEventSource: eventSource, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: eventSource, virtualKey: code, keyDown: false) else { return false }
    down.flags = flags; up.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(25_000)
    // Always release a key already pressed, even if focus changed in the meantime.
    up.post(tap: .cghidEventTap)
    usleep(35_000)
    return front(pid)
}
func waitReleased(_ pid: pid_t) -> Bool {
    for _ in 0..<60 {
        if !front(pid) { return false }
        if !forbiddenModifier() && !shift() && ![36,53].contains(where: { held(CGKeyCode($0)) }) { return true }
        usleep(25_000)
    }
    return false
}
func selectLine(_ pid: pid_t) -> Bool {
    if selection == "command-arrows" {
        return tap(124, .maskCommand, pid) && tap(123, [.maskCommand, .maskShift], pid)
    }
    return tap(119, [], pid) && tap(115, .maskShift, pid) // End, Shift+Home
}
if mode == "ocr" || mode == "ocr-select" { runMacOcr() }
if mode != "send" { fputs("Unsupported helper mode\n", stderr); exit(2) }
print("ready"); fflush(stdout)
while let command = readLine() {
    if command != "copy" && command != "send" { continue }
    guard AXIsProcessTrusted(), CGPreflightListenEventAccess() else { print("NOT DONE: enable Accessibility and Input Monitoring in macOS System Settings"); fflush(stdout); continue }
    guard let pid = owner(), waitReleased(pid), selectLine(pid) else { print("NOT DONE: game not foreground or keys held"); fflush(stdout); continue }
    let success: Bool
    if command == "copy" {
        success = tap(8, copyModifier, pid) // C
        usleep(100_000)
    } else {
        success = tap(9, copyModifier, pid) // V
        usleep(150_000)
    }
    if !success || !front(pid) { print("NOT DONE: game lost focus"); fflush(stdout); continue }
    if command == "send" && !tap(36, [], pid) { print("NOT DONE: game lost focus before Enter"); fflush(stdout); continue }
    print(command == "copy" ? "copied" : "sent"); fflush(stdout)
}
