import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import Foundation
import PDFKit
import Security
import Vision

// A deliberately small, JSON-only native boundary. It is compiled as part of
// the macOS package and never evaluates request data as a shell command.
typealias Json = [String: Any]

func emit(_ object: Json) {
  guard JSONSerialization.isValidJSONObject(object),
        let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
    FileHandle.standardOutput.write(Data("{\"ok\":false,\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"Could not encode macOS helper response\",\"recoverable\":true}}".utf8))
    return
  }
  FileHandle.standardOutput.write(data)
}

func success(_ value: Json) { emit(["ok": true, "value": value]) }
func failure(_ code: String = "INTERNAL_ERROR", _ message: String, _ recoverable: Bool = true) {
  emit(["ok": false, "error": ["code": code, "message": message, "recoverable": recoverable]])
}

func object(_ value: Any?) -> Json { value as? Json ?? [:] }
func string(_ value: Any?, _ fallback: String = "") -> String { value as? String ?? fallback }
func integer(_ value: Any?, _ fallback: Int = 0) -> Int {
  if let number = value as? NSNumber { return number.intValue }
  return fallback
}
func bool(_ value: Any?, _ fallback: Bool = false) -> Bool {
  if let number = value as? NSNumber { return number.boolValue }
  return fallback
}
func operation(_ input: Json) -> String { string(input["action"], string(input["operation"])) }

func shell(_ executable: String, _ arguments: [String]) -> String {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: executable)
  task.arguments = arguments
  let pipe = Pipe()
  task.standardOutput = pipe
  task.standardError = pipe
  do { try task.run() } catch { return "" }
  task.waitUntilExit()
  return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
}

func sysctlString(_ name: String) -> String {
  var size = 0
  guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return "" }
  var bytes = [CChar](repeating: 0, count: size)
  guard sysctlbyname(name, &bytes, &size, nil, 0) == 0 else { return "" }
  return String(cString: bytes)
}

func sysctlInt(_ name: String) -> Int64 {
  var value: Int64 = 0
  var size = MemoryLayout<Int64>.size
  guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return 0 }
  return value
}

func systemInfo(_ input: Json) -> Json {
  let action = operation(input).isEmpty ? "all" : operation(input)
  let cpu: Json = [
    "model": sysctlString("machdep.cpu.brand_string").isEmpty ? sysctlString("hw.model") : sysctlString("machdep.cpu.brand_string"),
    "cores": Int(sysctlInt("hw.physicalcpu")),
    "logical_processors": ProcessInfo.processInfo.processorCount,
  ]
  let memory: Json = ["total_bytes": Double(ProcessInfo.processInfo.physicalMemory)]
  let root = URL(fileURLWithPath: "/")
  let volume = try? root.resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityKey, .volumeLocalizedNameKey])
  let totalBytes = Double((volume?.volumeTotalCapacity ?? nil) ?? 0)
  let freeBytes = Double((volume?.volumeAvailableCapacity ?? nil) ?? 0)
  let disks: Json = ["drives": [[
    "device": "/", "volume": volume?.volumeLocalizedName ?? "Macintosh HD", "filesystem": "APFS",
    "total_bytes": totalBytes,
    "free_bytes": freeBytes,
  ]]]
  let uptime = ProcessInfo.processInfo.systemUptime
  let batteryText = shell("/usr/bin/pmset", ["-g", "batt"])
  let hasBattery = !batteryText.localizedCaseInsensitiveContains("no batteries") && batteryText.localizedCaseInsensitiveContains("battery")
  let percentage: Int? = {
    guard let range = batteryText.range(of: "[0-9]{1,3}%", options: .regularExpression) else { return nil }
    return Int(batteryText[range].dropLast())
  }()
  let battery: Json = hasBattery
    ? ["present": true, "percentage": percentage as Any, "status": batteryText.contains("charging") ? "charging" : batteryText.contains("discharging") ? "discharging" : "unknown"]
    : ["present": false]
  let os: Json = [
    "name": "macOS", "version": ProcessInfo.processInfo.operatingSystemVersionString,
    "architecture": "arm64", "computer_name": Host.current().localizedName ?? "",
    "manufacturer": "Apple", "model": sysctlString("hw.model"),
  ]
  let count = max(1, min(500, integer(input["top_count"], 10)))
  let rows = shell("/bin/ps", ["-axo", "pid=,rss=,time=,comm="]).split(separator: "\n").prefix(count).map { line -> Json in
    let fields = line.split(maxSplits: 3, whereSeparator: { $0 == " " || $0 == "\t" })
    return ["pid": Int(fields.first ?? "0") ?? 0, "memory_bytes": Double((Int(fields.dropFirst().first ?? "0") ?? 0) * 1024), "cpu_time_seconds": String(fields.dropFirst(2).first ?? ""), "name": String(fields.last ?? "")]
  }
  switch action {
  case "cpu": return cpu
  case "memory": return memory
  case "disks": return disks
  case "battery": return battery
  case "uptime": return ["uptime_seconds": uptime]
  case "os": return os
  case "processes": return ["processes": rows]
  default: return ["os": os, "cpu": cpu, "memory": memory, "disks": disks, "battery": battery, "uptime": ["uptime_seconds": uptime], "top_processes": ["processes": rows]]
  }
}

func pngResult(_ image: CGImage, source: String, originX: CGFloat = 0, originY: CGFloat = 0) throws -> Json {
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let data = bitmap.representation(using: .png, properties: [:]), data.count <= 16 * 1024 * 1024 else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Screen capture is too large"]) }
  return ["format": "png", "mime_type": "image/png", "data_base64": data.base64EncodedString(), "width": image.width, "height": image.height, "origin_x": originX, "origin_y": originY, "source": source, "backend": "CoreGraphics"]
}

func vision(_ input: Json) throws -> Json {
  let action = operation(input)
  if action == "annotate" {
    guard let encoded = input["image_base64"] as? String,
          let data = Data(base64Encoded: encoded),
          let image = NSImage(data: data),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "image_base64 is required for annotation"])
    }
    let canvas = NSImage(size: NSSize(width: cgImage.width, height: cgImage.height))
    canvas.lockFocus()
    guard let graphics = NSGraphicsContext.current?.cgContext else {
      canvas.unlockFocus()
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not prepare annotation image"])
    }
    graphics.draw(cgImage, in: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
    graphics.setStrokeColor(NSColor.systemRed.cgColor)
    graphics.setLineWidth(3)
    for item in (input["marks"] as? [Any] ?? []) {
      let mark = object(item), bounds = object(mark["bounds"])
      let width = integer(bounds["width"]), height = integer(bounds["height"])
      guard width > 0, height > 0 else { continue }
      let rect = CGRect(x: integer(bounds["x"]), y: integer(bounds["y"]), width: width, height: height)
      graphics.stroke(rect)
      let label = string(mark["mark_id"])
      if !label.isEmpty {
        let attributes: [NSAttributedString.Key: Any] = [.foregroundColor: NSColor.yellow, .font: NSFont.boldSystemFont(ofSize: 12)]
        let labelSize = (label as NSString).size(withAttributes: attributes)
        graphics.setFillColor(NSColor.black.withAlphaComponent(0.75).cgColor)
        graphics.fill(CGRect(x: rect.origin.x, y: rect.origin.y, width: max(24, labelSize.width + 8), height: max(20, labelSize.height + 4)))
        (label as NSString).draw(at: CGPoint(x: rect.origin.x + 4, y: rect.origin.y + 2), withAttributes: attributes)
      }
    }
    canvas.unlockFocus()
    guard let tiff = canvas.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]), png.count <= 16 * 1024 * 1024 else {
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Annotated image is too large"])
    }
    return ["format": "png", "mime_type": "image/png", "data_base64": png.base64EncodedString(), "width": cgImage.width, "height": cgImage.height, "annotated": true, "backend": "CoreGraphics Set-of-Marks overlay"]
  }
  if action == "ocr" {
    guard let encoded = input["image_base64"] as? String, let data = Data(base64Encoded: encoded), let image = NSImage(data: data), let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "image_base64 is required for OCR"]) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    return ["text": lines.joined(separator: "\n"), "lines": lines, "backend": "Vision"]
  }
  let capturePath = FileManager.default.temporaryDirectory.appendingPathComponent("lnwjud-capture-\(UUID().uuidString).png")
  defer { try? FileManager.default.removeItem(at: capturePath) }
  var arguments = ["-x"]
  if action == "capture_region" {
    let region = object(input["region"])
    let rect = CGRect(x: integer(region["x"]), y: integer(region["y"]), width: integer(region["width"]), height: integer(region["height"]))
    guard rect.width > 0, rect.height > 0 else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Requested capture region is invalid"]) }
    arguments.append("-R\(Int(rect.origin.x)),\(Int(rect.origin.y)),\(Int(rect.width)),\(Int(rect.height))")
  } else if action == "capture_window" {
    let selected = (input["window_index"] as? NSNumber).flatMap { index -> Json? in
      let all = windowRecords(); let value = index.intValue
      return value >= 0 && value < all.count ? all[value] : nil
    } ?? selectedWindow(object(input["app"]))
    guard let window = selected, integer(window["window_id"]) > 0 else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Window not found"]) }
    arguments.append("-l\(integer(window["window_id"]))")
  } else if action != "capture_display" {
    throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported vision action: \(action)"])
  }
  arguments.append(capturePath.path)
  _ = shell("/usr/sbin/screencapture", arguments)
  guard let image = NSImage(contentsOf: capturePath), let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Screen capture requires Screen Recording permission"]) }
  if action == "capture_region" {
    let region = object(input["region"])
    return try pngResult(cgImage, source: action, originX: CGFloat(integer(region["x"])), originY: CGFloat(integer(region["y"])))
  }
  return try pngResult(cgImage, source: action)
}

func windowRecords() -> [Json] {
  let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  return entries.compactMap { entry in
    guard integer(entry[kCGWindowLayer as String]) == 0 else { return nil }
    let bounds = entry[kCGWindowBounds as String] as? [String: Any] ?? [:]
    return [
      "window_id": integer(entry[kCGWindowNumber as String]), "title": string(entry[kCGWindowName as String]),
      "process_name": string(entry[kCGWindowOwnerName as String]), "pid": integer(entry[kCGWindowOwnerPID as String]),
      "visible": true, "minimized": false,
      "bounds": ["x": integer(bounds["X"]), "y": integer(bounds["Y"]), "width": integer(bounds["Width"]), "height": integer(bounds["Height"])],
    ]
  }
}

func selectedWindow(_ input: Json) -> Json? {
  let all = windowRecords()
  let requestedId = integer(input["window_id"], integer(input["id"]))
  if requestedId > 0, let found = all.first(where: { integer($0["window_id"]) == requestedId }) { return found }
  if let index = input["window_index"] as? NSNumber, index.intValue >= 0, index.intValue < all.count { return all[index.intValue] }
  let title = string(input["title"]).lowercased()
  let process = string(input["process_name"]).lowercased()
  return all.first { record in
    (title.isEmpty || string(record["title"]).lowercased().contains(title)) && (process.isEmpty || string(record["process_name"]).lowercased().contains(process))
  }
}

func axAttribute<T>(_ element: AXUIElement, _ attribute: String) -> T? {
  var result: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else { return nil }
  return result as? T
}

func axWindows(_ pid: pid_t) -> [AXUIElement] {
  let application = AXUIElementCreateApplication(pid)
  return axAttribute(application, kAXWindowsAttribute as String) ?? []
}

func axWindow(_ selected: Json) -> AXUIElement? {
  let pid = pid_t(integer(selected["pid"]))
  let title = string(selected["title"])
  let windows = axWindows(pid)
  if let exact = windows.first(where: { (axAttribute($0, kAXTitleAttribute as String) as String? ?? "") == title }) { return exact }
  return windows.first
}

func setAxPoint(_ window: AXUIElement, _ value: CGPoint) -> Bool {
  var point = value
  guard let boxed = AXValueCreate(.cgPoint, &point) else { return false }
  return AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, boxed) == .success
}

func setAxSize(_ window: AXUIElement, _ value: CGSize) -> Bool {
  var size = value
  guard let boxed = AXValueCreate(.cgSize, &size) else { return false }
  return AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, boxed) == .success
}

func window(_ input: Json) throws -> Json {
  let action = operation(input)
  if action == "list" || action.isEmpty { return ["windows": windowRecords()] }
  if action == "get_active" {
    guard let frontmost = NSWorkspace.shared.frontmostApplication else { return ["window": NSNull()] }
    return ["window": windowRecords().first(where: { integer($0["pid"]) == Int(frontmost.processIdentifier) }) ?? NSNull()]
  }
  guard let selected = selectedWindow(input) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Window not found"]) }
  if action == "get_bounds" { return object(selected["bounds"]) }
  if action == "get_display" {
    let bounds = object(selected["bounds"])
    let center = CGPoint(x: integer(bounds["x"]) + integer(bounds["width"]) / 2, y: integer(bounds["y"]) + integer(bounds["height"]) / 2)
    let screen = NSScreen.screens.first(where: { $0.frame.contains(center) }) ?? NSScreen.main
    guard let display = screen else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Display not found"]) }
    return ["display_id": display.localizedName, "primary": display == NSScreen.main, "bounds": ["x": display.frame.origin.x, "y": display.frame.origin.y, "width": display.frame.width, "height": display.frame.height]]
  }
  let pid = pid_t(integer(selected["pid"]))
  guard let app = NSRunningApplication(processIdentifier: pid) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Application is no longer running"]) }
  if action == "activate" { return ["activated": app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps]), "window": selected] }
  guard AXIsProcessTrusted(), let ax = axWindow(selected) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for this window action"]) }
  if action == "close" {
    guard let button: AXUIElement = axAttribute(ax, kAXCloseButtonAttribute as String) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Window does not expose a close button"]) }
    return ["closed": AXUIElementPerformAction(button, kAXPressAction as CFString) == .success, "window_id": integer(selected["window_id"])]
  }
  if action == "minimize" { return ["minimized": AXUIElementSetAttributeValue(ax, kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success, "window_id": integer(selected["window_id"])] }
  if action == "maximize" { return ["maximized": AXUIElementSetAttributeValue(ax, "AXFullScreen" as CFString, kCFBooleanTrue) == .success, "window_id": integer(selected["window_id"])] }
  if action == "restore" {
    let unminimized = AXUIElementSetAttributeValue(ax, kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success
    let unmaximized = AXUIElementSetAttributeValue(ax, "AXFullScreen" as CFString, kCFBooleanFalse) == .success
    return ["restored": unminimized || unmaximized, "window_id": integer(selected["window_id"])]
  }
  let currentBounds = object(selected["bounds"])
  let x = action == "resize" ? integer(currentBounds["x"]) : integer(input["x"])
  let y = action == "resize" ? integer(currentBounds["y"]) : integer(input["y"])
  let width = action == "move" ? integer(currentBounds["width"]) : integer(input["width"])
  let height = action == "move" ? integer(currentBounds["height"]) : integer(input["height"])
  if action == "move" || action == "resize" || action == "set_window_frame" {
    guard width > 0, height > 0 else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Window frame is invalid"]) }
    let positioned = setAxPoint(ax, CGPoint(x: x, y: y)), sized = setAxSize(ax, CGSize(width: width, height: height))
    return [action == "move" ? "moved" : action == "resize" ? "resized" : "framed": positioned && sized, "window_id": integer(selected["window_id"])]
  }
  throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported window action: \(action)"])
}

func axBounds(_ element: AXUIElement) -> Json? {
  guard let positionValue: AXValue = axAttribute(element, kAXPositionAttribute as String),
        let sizeValue: AXValue = axAttribute(element, kAXSizeAttribute as String) else { return nil }
  var position = CGPoint.zero, size = CGSize.zero
  guard AXValueGetValue(positionValue, .cgPoint, &position), AXValueGetValue(sizeValue, .cgSize, &size) else { return nil }
  return ["x": position.x, "y": position.y, "width": size.width, "height": size.height]
}

func axElementRecord(_ element: AXUIElement) -> Json {
  let role: String = axAttribute(element, kAXRoleAttribute as String) ?? ""
  let subrole: String = axAttribute(element, kAXSubroleAttribute as String) ?? ""
  let title: String = axAttribute(element, kAXTitleAttribute as String) ?? ""
  let description: String = axAttribute(element, kAXDescriptionAttribute as String) ?? ""
  let identifier: String = axAttribute(element, kAXIdentifierAttribute as String) ?? ""
  let enabled: NSNumber? = axAttribute(element, kAXEnabledAttribute as String)
  let hidden: NSNumber? = axAttribute(element, kAXHiddenAttribute as String)
  return [
    "name": title.isEmpty ? description : title,
    "automation_id": identifier,
    "control_type": role,
    "class_name": subrole,
    "enabled": enabled?.boolValue ?? true,
    "offscreen": hidden?.boolValue ?? false,
    "bounds": axBounds(element) ?? NSNull(),
  ]
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  axAttribute(element, kAXChildrenAttribute as String) ?? []
}

func addAxTree(_ element: AXUIElement, _ elements: inout [Json], _ depth: Int, _ maxDepth: Int, _ maxItems: Int) {
  guard elements.count < maxItems else { return }
  elements.append(["depth": depth, "element": axElementRecord(element)])
  guard depth < maxDepth else { return }
  for child in axChildren(element) {
    addAxTree(child, &elements, depth + 1, maxDepth, maxItems)
    if elements.count >= maxItems { return }
  }
}

func findAxElement(_ element: AXUIElement, _ name: String, _ identifier: String, _ remaining: inout Int) -> AXUIElement? {
  guard remaining > 0 else { return nil }
  remaining -= 1
  let record = axElementRecord(element)
  let candidateName = string(record["name"])
  let candidateIdentifier = string(record["automation_id"])
  if (!name.isEmpty && candidateName == name) || (!identifier.isEmpty && candidateIdentifier == identifier) { return element }
  for child in axChildren(element) {
    if let found = findAxElement(child, name, identifier, &remaining) { return found }
  }
  return nil
}

func axRoot(_ input: Json) -> AXUIElement {
  let hasSelector = integer(input["window_id"], integer(input["id"])) > 0
    || input["window_index"] is NSNumber
    || !string(input["title"]).isEmpty
    || !string(input["process_name"]).isEmpty
  if hasSelector, let selected = selectedWindow(input), let result = axWindow(selected) { return result }
  return AXUIElementCreateSystemWide()
}

func performAxAction(_ element: AXUIElement, _ candidates: [String]) -> String? {
  var actions: CFArray?
  guard AXUIElementCopyActionNames(element, &actions) == .success,
        let names = actions as? [String] else { return nil }
  for candidate in candidates where names.contains(candidate) {
    if AXUIElementPerformAction(element, candidate as CFString) == .success { return candidate }
  }
  return nil
}

func accessibility(_ input: Json) throws -> Json {
  let action = operation(input)
  if action == "status" {
    let trusted = AXIsProcessTrusted()
    return ["available": trusted, "ready": trusted, "backend": "macOS Accessibility"]
  }
  if action == "list_windows" { return ["windows": windowRecords()] }
  if action == "launch_app" {
    let executable = string(input["executable"])
    guard !executable.isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "executable is required"]) }
    let opened = NSWorkspace.shared.open(URL(fileURLWithPath: executable))
    guard opened else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not launch application"]) }
    return ["started": true, "executable": executable]
  }
  let windowActions: [String: String] = [
    "activate_app": "activate", "close_window": "close", "minimize_window": "minimize",
    "maximize_window": "maximize", "restore_window": "restore", "set_window_frame": "set_window_frame",
  ]
  if let mapped = windowActions[action] {
    var request = input; request["operation"] = mapped; request["action"] = mapped
    return try window(request)
  }
  guard AXIsProcessTrusted() else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required for semantic UI automation"]) }
  let root = axRoot(input)
  if ["observe", "observe_summary", "observe_changes", "inspect_elements"].contains(action) {
    let maxDepth = max(0, min(12, integer(input["max_depth"], 4)))
    let maxItems = max(1, min(2_000, integer(input["max_items"], 200)))
    var elements: [Json] = []
    addAxTree(root, &elements, 0, maxDepth, maxItems)
    return ["elements": elements, "count": elements.count]
  }
  let name = string(input["name"]), identifier = string(input["automation_id"])
  guard !name.isEmpty || !identifier.isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "name or automation_id is required"]) }
  var remaining = 2_000
  guard let element = findAxElement(root, name, identifier, &remaining) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "UI element was not found"]) }
  let record = axElementRecord(element)
  if action == "find_element" { return ["element": record] }
  if action == "focus" {
    let focused = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
    return ["focused": focused, "element": record]
  }
  if action == "click" {
    guard let method = performAxAction(element, [kAXPressAction as String, kAXConfirmAction as String, kAXPickAction as String]) else {
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "UI element does not expose an invokable action"])
    }
    return ["clicked": true, "method": method, "element": record]
  }
  if action == "read_value" {
    let value: String = axAttribute(element, kAXValueAttribute as String) ?? string(record["name"])
    return ["value": value]
  }
  if action == "set_value" {
    let value = string(input["value"])
    guard AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString) == .success else {
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "UI element does not accept a value"])
    }
    return ["set": true, "value": value]
  }
  if action == "select_item" {
    let selected = AXUIElementSetAttributeValue(element, kAXSelectedAttribute as CFString, kCFBooleanTrue) == .success
    let method = selected ? "selection_item_pattern" : performAxAction(element, [kAXPressAction as String])
    guard selected || method != nil else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "UI element cannot be selected"]) }
    return ["selected": true, "method": method ?? "selection_item_pattern", "element": record]
  }
  if action == "menu_select" {
    guard let method = performAxAction(element, [kAXPressAction as String, kAXPickAction as String]) else {
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Menu item cannot be invoked"])
    }
    return ["selected": true, "method": method, "element": record]
  }
  throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported accessibility action: \(action)"])
}

func keyCode(_ key: String) -> CGKeyCode? {
  let named: [String: CGKeyCode] = ["RETURN": 36, "ENTER": 36, "ESC": 53, "ESCAPE": 53, "TAB": 48, "SPACE": 49, "DELETE": 51, "BACKSPACE": 51, "FORWARD_DELETE": 117, "INSERT": 114, "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126, "HOME": 115, "END": 119, "PAGEUP": 116, "PAGEDOWN": 121, "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111, "A": 0, "B": 11, "C": 8, "D": 2, "E": 14, "F": 3, "G": 5, "H": 4, "I": 34, "J": 38, "K": 40, "L": 37, "M": 46, "N": 45, "O": 31, "P": 35, "Q": 12, "R": 15, "S": 1, "T": 17, "U": 32, "V": 9, "W": 13, "X": 7, "Y": 16, "Z": 6, "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25, "-": 27, "=": 24, "[": 33, "]": 30, ";": 41, "'": 39, ",": 43, ".": 47, "/": 44, "`": 50]
  if let value = named[key.uppercased()] { return value }
  return nil
}

func inputKeyCode(_ value: Any?) -> CGKeyCode? {
  if let number = value as? NSNumber, number.intValue >= 0, number.intValue <= 127 { return CGKeyCode(number.intValue) }
  return keyCode(string(value))
}

func modifierFlags(_ values: Any?) -> CGEventFlags {
  var flags: CGEventFlags = []
  for value in values as? [Any] ?? [] {
    switch string(value).lowercased() {
    case "command", "cmd", "meta": flags.insert(.maskCommand)
    case "control", "ctrl": flags.insert(.maskControl)
    case "option", "alt": flags.insert(.maskAlternate)
    case "shift": flags.insert(.maskShift)
    default: break
    }
  }
  return flags
}

func modifierKeyCode(_ name: String) -> CGKeyCode? {
  switch name.lowercased() {
  case "command", "cmd", "meta": return 55
  case "control", "ctrl": return 59
  case "option", "alt": return 58
  case "shift": return 56
  default: return nil
  }
}

func postMouse(_ type: CGEventType, _ x: Int, _ y: Int, button: CGMouseButton = .left) {
  let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: button)
  event?.post(tap: .cghidEventTap)
}

func inputEvent(_ input: Json) throws -> Json {
  guard CGPreflightPostEventAccess() else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Accessibility permission is required to send input events"]) }
  let action = operation(input)
  if action == "type_text" || action == "paste_text" {
    let text = string(input["text"])
    let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
    event?.keyboardSetUnicodeString(stringLength: text.utf16.count, unicodeString: Array(text.utf16))
    event?.post(tap: .cghidEventTap)
    return ["typed": true]
  }
  if action == "press_key" {
    guard let code = inputKeyCode(input["key"]) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported key"]) }
    let flags = modifierFlags(input["modifiers"])
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true); down?.flags = flags; down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false); up?.flags = flags; up?.post(tap: .cghidEventTap)
    return ["pressed": true]
  }
  if action == "key_down" || action == "key_up" {
    guard let code = inputKeyCode(input["key"]) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported key"]) }
    let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: action == "key_down")
    event?.flags = modifierFlags(input["modifiers"]); event?.post(tap: .cghidEventTap)
    return [action == "key_down" ? "down" : "up": true]
  }
  if action == "hotkey" {
    guard let code = inputKeyCode(input["key"]) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported key"]) }
    let names = (input["modifiers"] as? [Any] ?? []).map { string($0) }
    for name in names { if let modifier = modifierKeyCode(name) { CGEvent(keyboardEventSource: nil, virtualKey: modifier, keyDown: true)?.post(tap: .cghidEventTap) } }
    CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)?.post(tap: .cghidEventTap)
    CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap)
    for name in names.reversed() { if let modifier = modifierKeyCode(name) { CGEvent(keyboardEventSource: nil, virtualKey: modifier, keyDown: false)?.post(tap: .cghidEventTap) } }
    return ["pressed": true, "hotkey": true]
  }
  let x = integer(input["x"]), y = integer(input["y"])
  if action == "mouse_move" { postMouse(.mouseMoved, x, y); return ["moved": true] }
  if action == "click" || action == "double_click" || action == "right_click" {
    let button: CGMouseButton = action == "right_click" ? .right : .left
    let down: CGEventType = action == "right_click" ? .rightMouseDown : .leftMouseDown
    let up: CGEventType = action == "right_click" ? .rightMouseUp : .leftMouseUp
    let count = action == "double_click" ? 2 : 1
    for _ in 0..<count { postMouse(down, x, y, button: button); postMouse(up, x, y, button: button) }
    return ["clicked": true, "count": count, "button": action == "right_click" ? "right" : "left"]
  }
  if action == "button_down" || action == "button_up" {
    let location = NSEvent.mouseLocation
    postMouse(action == "button_down" ? .leftMouseDown : .leftMouseUp, Int(location.x), Int(location.y))
    return [action == "button_down" ? "down" : "up": true]
  }
  if action == "scroll" {
    let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(integer(input["delta_y"])), wheel2: 0, wheel3: 0)
    event?.post(tap: .cghidEventTap); return ["scrolled": true]
  }
  if action == "drag" {
    let from = object(input["from"]), to = object(input["to"])
    let fromX = integer(from["x"]), fromY = integer(from["y"]), toX = integer(to["x"]), toY = integer(to["y"])
    postMouse(.mouseMoved, fromX, fromY); postMouse(.leftMouseDown, fromX, fromY); postMouse(.leftMouseDragged, toX, toY); postMouse(.leftMouseUp, toX, toY)
    return ["dragged": true]
  }
  if action == "release_all" {
    for code: CGKeyCode in [55, 59, 58, 56] { CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap) }
    let location = NSEvent.mouseLocation; postMouse(.leftMouseUp, Int(location.x), Int(location.y)); postMouse(.rightMouseUp, Int(location.x), Int(location.y), button: .right)
    return ["released": true]
  }
  if action == "sequence" {
    var results: [Json] = []
    for step in input["steps"] as? [Any] ?? [] {
      let raw = object(step), parameters = object(raw["parameters"])
      var request = parameters.isEmpty ? raw : parameters
      request["operation"] = raw["operation"]
      results.append(try inputEvent(request))
    }
    return ["steps": results]
  }
  throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported input operation: \(action)"])
}

func clipboard(_ input: Json) throws -> Json {
  let board = NSPasteboard.general
  switch operation(input) {
  case "get_text": return ["text": board.string(forType: .string) ?? ""]
  case "set_text":
    let text = string(input["text"])
    guard text.count <= 1_000_000 else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Clipboard text is too long"]) }
    board.clearContents(); board.setString(text, forType: .string)
    return ["set": true, "length": text.count]
  case "get_image":
    guard let image = NSImage(pasteboard: board), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil), let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { return ["present": false] }
    return ["present": true, "format": "png", "mime_type": "image/png", "width": cg.width, "height": cg.height, "data_base64": data.base64EncodedString()]
  default: throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported clipboard action"])
  }
}

func dialogExtensions(_ filter: String) -> [String] {
  let entries = filter.split(separator: "|").flatMap { $0.split(separator: ";") }
  return entries.compactMap { entry in
    let pattern = entry.trimmingCharacters(in: .whitespacesAndNewlines)
    guard pattern.hasPrefix("*.") else { return nil }
    let value = pattern
      .replacingOccurrences(of: "*.", with: "")
      .trimmingCharacters(in: CharacterSet(charactersIn: "."))
      .lowercased()
    guard !value.isEmpty, value != "*", value.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }), value.count <= 32 else { return nil }
    return value
  }
}

func fileDialog(_ input: Json) throws -> Json {
  NSApplication.shared.setActivationPolicy(.accessory)
  let action = operation(input)
  let filter = string(input["filter"])
  let extensions = dialogExtensions(filter)
  if !filter.isEmpty && extensions.isEmpty {
    throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "file_dialog filter must contain one or more patterns such as *.pdf;*.docx"])
  }
  if action == "open" {
    let panel = NSOpenPanel(); panel.allowsMultipleSelection = bool(input["multi_select"]); panel.canChooseDirectories = false
    if !extensions.isEmpty { panel.allowedFileTypes = extensions }
    if let directory = input["initial_directory"] as? String { panel.directoryURL = URL(fileURLWithPath: directory) }
    guard panel.runModal() == .OK else { return ["canceled": true, "paths": []] }
    return ["canceled": false, "paths": panel.urls.map { $0.path }]
  }
  let panel = NSSavePanel()
  if !extensions.isEmpty { panel.allowedFileTypes = extensions }
  if let directory = input["initial_directory"] as? String { panel.directoryURL = URL(fileURLWithPath: directory) }
  panel.nameFieldStringValue = string(input["file_name"])
  guard panel.runModal() == .OK else { return ["canceled": true, "path": NSNull()] }
  return ["canceled": false, "path": panel.url?.path ?? ""]
}

func microphoneAuthorized() -> Bool {
  let current = AVCaptureDevice.authorizationStatus(for: .audio)
  if current == .authorized { return true }
  if current != .notDetermined { return false }
  let gate = DispatchSemaphore(value: 0)
  var granted = false
  AVCaptureDevice.requestAccess(for: .audio) { value in granted = value; gate.signal() }
  _ = gate.wait(timeout: .now() + 30)
  return granted
}

func audio(_ input: Json) throws -> Json {
  let action = operation(input)
  if action == "record" {
    guard microphoneAuthorized() else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone permission is required for audio recording"]) }
    let output = string(input["output_path"])
    guard !output.isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "output_path is required"]) }
    let url = URL(fileURLWithPath: output)
    let duration = max(1, min(600, integer(input["duration_seconds"], 5)))
    let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false]
    let recorder = try AVAudioRecorder(url: url, settings: settings)
    guard recorder.prepareToRecord(), recorder.record() else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not start microphone recording"]) }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: TimeInterval(duration)))
    recorder.stop()
    return ["recorded": true, "output_path": output, "duration_seconds": duration, "backend": "AVFoundation"]
  }
  if action == "play" {
    let file = string(input["file_path"])
    guard !file.isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "file_path is required"]) }
    let player = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: file))
    guard player.play() else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not start audio playback"]) }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: min(player.duration, 600)))
    player.stop()
    return ["played": true, "file_path": file, "backend": "AVFoundation"]
  }
  if action == "stop" { return ["stopped": true, "note": "audio record/play calls are synchronous on macOS"] }
  throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported audio action: \(action)"])
}

func screenRecordStatePath() -> URL { URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("lnwjud-screen-record-state.json") }

func screenRecord(_ input: Json) throws -> Json {
  let action = operation(input)
  let statePath = screenRecordStatePath()
  if action == "start" {
    let output = string(input["output_path"])
    guard !output.isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "output_path is required"]) }
    guard FileManager.default.fileExists(atPath: URL(fileURLWithPath: output).deletingLastPathComponent().path) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Output directory does not exist"]) }
    if input["fps"] != nil {
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "fps is unavailable with the built-in macOS screencapture provider; omit fps or use a provider that supports frame-rate control"])
    }
    let hasRegion = input["offset_x"] != nil || input["offset_y"] != nil || input["width"] != nil || input["height"] != nil
    if hasRegion && (input["offset_x"] == nil || input["offset_y"] == nil || input["width"] == nil || input["height"] == nil) {
      throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "offset_x, offset_y, width, and height are all required for a recording region"])
    }
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    var arguments = ["-x", "-v", "-V", "3600"]
    if hasRegion { arguments.append("-R\(integer(input["offset_x"])),\(integer(input["offset_y"])),\(integer(input["width"])),\(integer(input["height"]))") }
    arguments.append(output)
    capture.arguments = arguments
    try capture.run()
    let state: Json = ["pid": capture.processIdentifier, "output_path": output, "started_at": ISO8601DateFormatter().string(from: Date())]
    let data = try JSONSerialization.data(withJSONObject: state)
    try data.write(to: statePath, options: .atomic)
    return ["recording": true, "pid": capture.processIdentifier, "output_path": output, "max_duration_seconds": 3600, "backend": "screencapture"]
  }
  guard let data = try? Data(contentsOf: statePath), let state = try? JSONSerialization.jsonObject(with: data) as? Json, let pid = state["pid"] as? NSNumber else {
    return action == "status" ? ["recording": false] : ["recording": false, "reason": "No active recording"]
  }
  let running = kill(pid.int32Value, 0) == 0
  if action == "status" { return ["recording": running, "pid": pid, "output_path": string(state["output_path"])] }
  if action == "stop" {
    if running { _ = kill(pid.int32Value, SIGINT) }
    try? FileManager.default.removeItem(at: statePath)
    return ["recording": false, "output_path": string(state["output_path"]), "exists": FileManager.default.fileExists(atPath: string(state["output_path"]))]
  }
  throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported screen record action: \(action)"])
}

func keychainSet(_ input: Json) throws -> Json {
  let service = string(input["service"]), account = string(input["account"]), secret = string(input["secret"])
  guard !service.isEmpty, !account.isEmpty, !secret.isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Keychain service, account, and secret are required"]) }
  let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
  SecItemDelete(query as CFDictionary)
  var attributes = query; attributes[kSecValueData] = Data(secret.utf8)
  let status = SecItemAdd(attributes as CFDictionary, nil)
  guard status == errSecSuccess else { throw NSError(domain: "lnwjud", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "macOS Keychain write failed (\(status))"]) }
  return ["stored": true]
}

func keychainGet(_ input: Json) throws -> Json {
  let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: string(input["service"]), kSecAttrAccount: string(input["account"]), kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
  var result: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &result)
  guard status == errSecSuccess, let data = result as? Data, let secret = String(data: data, encoding: .utf8) else { throw NSError(domain: "lnwjud", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "macOS Keychain lookup failed (\(status))"]) }
  return ["secret": secret]
}

/** Run a fixed JXA program with request values encoded as JSON literals.
    No input is ever concatenated as JavaScript source. */
func jxaLiteral(_ value: Any) throws -> String {
  guard JSONSerialization.isValidJSONObject([value]),
        let data = try? JSONSerialization.data(withJSONObject: [value]),
        let text = String(data: data, encoding: .utf8),
        text.count >= 2 else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Office request could not be encoded"]) }
  return String(text.dropFirst().dropLast())
}

func runJxa(_ source: String) throws -> Json {
  let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript"); task.arguments = ["-l", "JavaScript", "-e", source]
  let output = Pipe(); task.standardOutput = output; task.standardError = output
  let finished = DispatchSemaphore(value: 0)
  task.terminationHandler = { _ in finished.signal() }
  try task.run()
  if finished.wait(timeout: .now() + 45) == .timedOut {
    task.terminate()
    throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Office automation timed out; close any Office dialog and retry"])
  }
  let text = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  guard task.terminationStatus == 0,
        let data = text.trimmingCharacters(in: .whitespacesAndNewlines).data(using: .utf8),
        let value = try? JSONSerialization.jsonObject(with: data) as? Json else {
    throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Office automation failed" : text.trimmingCharacters(in: .whitespacesAndNewlines)])
  }
  return value
}

func office(_ input: Json) throws -> Json {
  let app = string(input["app"]).lowercased(), action = string(input["action"]).lowercased(), filePath = string(input["file_path"])
  guard ["excel", "word", "powerpoint", "outlook"].contains(app) else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported Office app"]) }
  if app != "outlook" && filePath.isEmpty { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "file_path is required"]) }
  if !filePath.isEmpty && !FileManager.default.fileExists(atPath: filePath) { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Office file was not found"]) }
  let file = try jxaLiteral(filePath), target = try jxaLiteral(string(input["target_path"])), sheet = try jxaLiteral(string(input["sheet"])), range = try jxaLiteral(string(input["range"]))
  if app == "excel" {
    if action == "read" {
      guard !string(input["range"]).isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "range is required"]) }
      return try runJxa("""
        const Excel = Application('Microsoft Excel'); Excel.visible = false; Excel.displayAlerts = false;
        const book = Excel.openWorkbook({workbookFileName: \(file), readOnly: true});
        const worksheet = \(sheet).length ? book.worksheets.byName(\(sheet)) : book.worksheets.at(0);
        const values = worksheet.range(\(range)).value(); book.close({saving: 'no'});
        JSON.stringify({app:'excel', action:'read', file_path:\(file), range:\(range), values:values});
      """)
    }
    if action == "write" {
      guard !string(input["range"]).isEmpty, input["values"] != nil else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "range and values are required"]) }
      let values = try jxaLiteral(input["values"]!)
      return try runJxa("""
        const Excel = Application('Microsoft Excel'); Excel.visible = false; Excel.displayAlerts = false;
        const book = Excel.openWorkbook({workbookFileName: \(file)});
        const worksheet = \(sheet).length ? book.worksheets.byName(\(sheet)) : book.worksheets.at(0);
        worksheet.range(\(range)).value = \(values); book.save(); book.close({saving: 'no'});
        JSON.stringify({app:'excel', action:'write', file_path:\(file), range:\(range), saved:true});
      """)
    }
    if action == "save_as" {
      guard !string(input["target_path"]).isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "target_path is required"]) }
      return try runJxa("""
        const Excel = Application('Microsoft Excel'); Excel.visible = false; Excel.displayAlerts = false;
        const book = Excel.openWorkbook({workbookFileName: \(file)}); book.saveAs({filename: \(target)}); book.close({saving: 'no'});
        JSON.stringify({app:'excel', action:'save_as', source:\(file), target:\(target), saved:true});
      """)
    }
    if action == "sheets" {
      return try runJxa("""
        const Excel = Application('Microsoft Excel'); Excel.visible = false; Excel.displayAlerts = false;
        const book = Excel.openWorkbook({workbookFileName: \(file), readOnly: true});
        const sheets = book.worksheets().map((worksheet) => { const used = worksheet.usedRange; return {name: worksheet.name(), used_range: used.address({rowAbsolute:false, columnAbsolute:false}), rows: used.rows.count(), columns: used.columns.count()}; });
        book.close({saving: 'no'}); JSON.stringify({app:'excel', action:'sheets', file_path:\(file), sheets:sheets});
      """)
    }
  }
  if app == "word" {
    if action == "read_text" {
      return try runJxa("""
        const Word = Application('Microsoft Word'); Word.visible = false;
        const document = Word.open(Path(\(file)), {readOnly:true}); const text = document.content.text(); document.close({saving:'no'});
        JSON.stringify({app:'word', action:'read_text', file_path:\(file), text:text});
      """)
    }
    if action == "save_as" {
      guard !string(input["target_path"]).isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "target_path is required"]) }
      return try runJxa("""
        const Word = Application('Microsoft Word'); Word.visible = false;
        const document = Word.open(Path(\(file))); document.saveAs({fileName: \(target)}); document.close({saving:'no'});
        JSON.stringify({app:'word', action:'save_as', source:\(file), target:\(target), saved:true});
      """)
    }
  }
  if app == "powerpoint" && action == "save_as" {
    guard !string(input["target_path"]).isEmpty else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "target_path is required"]) }
    return try runJxa("""
      const PowerPoint = Application('Microsoft PowerPoint'); PowerPoint.visible = false;
      const presentation = PowerPoint.presentations.open(\(file), {withWindow:false}); presentation.saveAs({filename: \(target)}); presentation.close();
      JSON.stringify({app:'powerpoint', action:'save_as', source:\(file), target:\(target), saved:true});
    """)
  }
  throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "This Office app/action is not supported by the installed macOS Automation dictionary"])
}

if CommandLine.arguments.count >= 3 && CommandLine.arguments.dropFirst().contains("-layout") {
  let candidates = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-") }
  if let file = candidates.first, let document = PDFDocument(url: URL(fileURLWithPath: file)) {
    FileHandle.standardOutput.write(Data((document.string ?? "").utf8))
    exit(0)
  }
  FileHandle.standardError.write(Data("PDF could not be opened\n".utf8))
  exit(1)
}

do {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard let raw = try JSONSerialization.jsonObject(with: data) as? Json else { throw NSError(domain: "lnwjud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Request must be a JSON object"]) }
  if let special = raw["operation"] as? String, special == "keychain_set" { success(try keychainSet(object(raw["input"]))); exit(0) }
  if let special = raw["operation"] as? String, special == "keychain_get" { success(try keychainGet(object(raw["input"]))); exit(0) }
  let capability = string(raw["capability"])
  let input = object(raw["input"])
  let parameters = object(input["parameters"])
  var invocation = parameters.isEmpty ? input : parameters
  if invocation["operation"] == nil { invocation["operation"] = input["operation"] }
  if invocation["action"] == nil { invocation["action"] = input["action"] }
  if invocation["app"] == nil { invocation["app"] = input["app"] }
  switch capability {
  case "system_info": success(systemInfo(invocation))
  case "vision": success(try vision(input))
  case "window": success(try window(invocation))
  case "accessibility": success(try accessibility(invocation))
  case "input_event": success(try inputEvent(invocation))
  case "clipboard": success(try clipboard(invocation))
  case "file_dialog": success(try fileDialog(invocation))
  case "audio": success(try audio(invocation))
  case "screen_record": success(try screenRecord(invocation))
  case "office": success(try office(invocation))
  case "notification":
    let title = string(invocation["title"]), message = string(invocation["message"])
    let titleLiteral = try jxaLiteral(title), messageLiteral = try jxaLiteral(message)
    _ = shell("/usr/bin/osascript", ["-l", "JavaScript", "-e", "const app = Application.currentApplication(); app.includeStandardAdditions = true; app.displayNotification(\(messageLiteral), {withTitle: \(titleLiteral)});"])
    success(["shown": true])
  default: failure("INTERNAL_ERROR", "macOS implementation for \(capability) is not available yet", true)
  }
} catch {
  failure("INTERNAL_ERROR", (error as NSError).localizedDescription, true)
}
