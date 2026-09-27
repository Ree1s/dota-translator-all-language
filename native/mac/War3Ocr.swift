import AppKit
import CoreGraphics
import Vision
import Foundation
import Darwin

final class OcrSelectionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

func ocrGameWindow() -> (CGWindowID, CGRect)? {
    guard let pid = owner(), let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
    for w in windows {
        guard (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (w[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let id = w[kCGWindowNumber as String] as? NSNumber,
              let bounds = w[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width > 200, rect.height > 150 else { continue }
        return (id.uint32Value, rect)
    }
    return nil
}

final class OcrSelectionView: NSView {
    var origin: CGPoint?
    var selection = CGRect.zero
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) { origin = convert(event.locationInWindow, from: nil) }
    override func mouseDragged(with event: NSEvent) {
        guard let start = origin else { return }
        let end = convert(event.locationInWindow, from: nil)
        selection = CGRect(x: min(start.x,end.x), y: min(start.y,end.y), width: abs(start.x-end.x), height: abs(start.y-end.y))
        needsDisplay = true
    }
    override func mouseUp(with event: NSEvent) {
        mouseDragged(with: event)
        guard selection.width >= 80, selection.height >= 20 else { return }
        emit(["kind":"region", "region":[selection.minX/bounds.width,selection.minY/bounds.height,selection.width/bounds.width,selection.height/bounds.height]])
        NSApp.stop(nil)
    }
    override func keyDown(with event: NSEvent) { if event.keyCode == 53 { NSApp.stop(nil) } }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.3).setFill(); bounds.fill()
        NSColor.systemGreen.setStroke(); let path = NSBezierPath(rect: selection); path.lineWidth = 2; path.stroke()
    }
}

func runMacOcr() -> Never {
    _ = NSApplication.shared
    guard CGPreflightScreenCaptureAccess() else {
        _ = CGRequestScreenCaptureAccess()
        emit(["kind":"error", "text":"Allow Screen Recording for Warcraft translator/helper in System Settings, then restart the translator."])
        exit(1)
    }
    if mode == "ocr-select" {
        emit(["kind":"status", "text":"Switch to Warcraft III within 5 seconds, then drag around received chat. Esc cancels."])
        Thread.sleep(forTimeInterval: 5)
        guard let (_, rect) = ocrGameWindow() else { emit(["kind":"error","text":"Warcraft III must be in front for selection."]); exit(1) }
        let primaryHeight = CGDisplayBounds(CGMainDisplayID()).height
        let frame = CGRect(x: rect.minX, y: primaryHeight-rect.maxY, width: rect.width, height: rect.height)
        NSApp.setActivationPolicy(.accessory)
        let panel = OcrSelectionPanel(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.level = .screenSaver; panel.isOpaque = false; panel.backgroundColor = .clear
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let view = OcrSelectionView(frame: CGRect(origin: .zero, size: rect.size))
        panel.contentView = view; panel.makeFirstResponder(view)
        NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
        NSApp.run(); panel.orderOut(nil); exit(0)
    }
    let region = option("--region").split(separator: ",").compactMap { Double($0) }
    guard region.count == 4, region.allSatisfy({ $0.isFinite && $0 >= 0 }), region[2] > 0, region[3] > 0, region[0]+region[2] <= 1.001, region[1]+region[3] <= 1.001 else { emit(["kind":"error","text":"Invalid OCR region"]); exit(1) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = [option("--language", "en-US")]
    request.usesLanguageCorrection = false
    emit(["kind":"ready", "language":request.recognitionLanguages[0], "region":region])
    while parent == 0 || kill(parent, 0) == 0 {
        let started = Date()
        autoreleasepool {
            guard let (id, rect) = ocrGameWindow() else { return }
            let crop = CGRect(x:rect.minX+rect.width*region[0], y:rect.minY+rect.height*region[1], width:rect.width*region[2], height:rect.height*region[3])
            // Capture only the game window, so subtitles cannot feed back into OCR.
            guard let image = CGWindowListCreateImage(crop, .optionIncludingWindow, id, [.boundsIgnoreFraming, .bestResolution]) else { emit(["kind":"error","text":"Game capture failed; check Screen Recording permission and use windowed mode."]); return }
            do {
                try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
                var rows: [[VNRecognizedTextObservation]] = []
                for observation in (request.results ?? []).sorted(by: { $0.boundingBox.midY > $1.boundingBox.midY }) {
                    if let i = rows.firstIndex(where: { abs($0[0].boundingBox.midY-observation.boundingBox.midY) < min($0[0].boundingBox.height,observation.boundingBox.height)*0.55 }) { rows[i].append(observation) }
                    else { rows.append([observation]) }
                }
                let lines = rows.map { row in row.sorted(by: { $0.boundingBox.minX < $1.boundingBox.minX }).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ") }
                emit(["kind":"frame","lines":lines,"ocrMs":Int(Date().timeIntervalSince(started)*1000),"window":["x":rect.minX,"y":rect.minY,"width":rect.width,"height":rect.height]])
            } catch { emit(["kind":"error","text":error.localizedDescription]) }
        }
        Thread.sleep(forTimeInterval: max(0.05, 0.5-Date().timeIntervalSince(started)))
    }
    exit(0)
}
