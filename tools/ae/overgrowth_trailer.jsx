// Overgrowth trailer builder for After Effects (File > Scripts > Run Script File...)
// Asks for your gameplay .mp4 (a Cmd+Shift+5 recording is fine), then builds a 1080p, 30fps, 20s comp
// cut into beats. Each beat states what's on screen, the action, the response, and the focal point,
// so timing can be tweaked per beat. All text is real text layers, so fonts and brand stay editable.
//
// Beats (seconds):
//  0.0-2.5   HOOK     black > "What if Minecraft TNT"  /  "leaked into The Last of Us?"  (type-on, punch-in)
//  2.5-7.0   BLOCKS   footage: B pressed, hotbar pops, a tower goes up   (label: "B · block mode")
//  7.0-11.0  SQUAD    footage: N pressed, villagers walk out with boards  (label: "5 AI agents. 5 TNT tests.")
// 11.0-14.5  BOOM     footage: chain reaction                             (white flash + shake on impact)
// 14.5-17.5  ASK      footage: Mira walks to camera, Y pressed, board turns green   (counter 4/5 > 5/5)
// 17.5-20.0  END      logo card "OVERGROWTH" + "play free · github.com/Arnie016/overgrowth"
//
// Set the IN points below to where each moment happens in YOUR recording (seconds into the clip).
var IN = { blocks: 2, squad: 30, boom: 60, ask: 90 };

(function () {
  app.beginUndoGroup("Overgrowth trailer");
  var W = 1920, H = 1080, FPS = 30, DUR = 20;
  var f = File.openDialog("Pick your Overgrowth gameplay recording (.mp4/.mov)");
  if (!f) { alert("No footage picked."); return; }
  var foot = app.project.importFile(new ImportOptions(f));
  var comp = app.project.items.addComp("Overgrowth_Trailer", W, H, 1, DUR, FPS);
  var MOSS = [0.56, 0.64, 0.35], INK = [0.91, 0.88, 0.81], RUST = [0.76, 0.39, 0.23];

  function ease(prop) { // smooth in/out on every key
    for (var k = 1; k <= prop.numKeys; k++) {
      var e = new KeyframeEase(0, 75), dims = prop.value instanceof Array ? prop.value.length : 1, arr = [];
      if (prop.propertyValueType == PropertyValueType.TwoD_SPATIAL || prop.propertyValueType == PropertyValueType.ThreeD_SPATIAL) dims = 1;
      for (var d = 0; d < dims; d++) arr.push(e);
      prop.setTemporalEaseAtKey(k, arr, arr);
    }
  }
  function clip(name, inSrc, start, end) {
    var L = comp.layers.add(foot); L.name = name;
    L.startTime = start - inSrc; L.inPoint = start; L.outPoint = end;
    var s = L.property("Scale"), sc = 100 * Math.max(W / foot.width, H / foot.height);
    s.setValueAtTime(start, [sc * 1.04, sc * 1.04]); s.setValueAtTime(end, [sc * 1.12, sc * 1.12]); // slow push-in
    return L;
  }
  function text(str, size, color, pos, start, end, font) {
    var L = comp.layers.addText(str), td = L.property("Source Text").value;
    td.fontSize = size; td.fillColor = color; td.justification = ParagraphJustification.CENTER_JUSTIFY;
    try { td.font = font || "Courier-Bold"; } catch (e) {}
    L.property("Source Text").setValue(td);
    L.property("Position").setValue(pos); L.inPoint = start; L.outPoint = end;
    var o = L.property("Opacity"); o.setValueAtTime(start, 0); o.setValueAtTime(start + 0.25, 100); o.setValueAtTime(end - 0.25, 100); o.setValueAtTime(end, 0);
    var sc = L.property("Scale"); sc.setValueAtTime(start, [115, 115]); sc.setValueAtTime(start + 0.35, [100, 100]); ease(sc);
    return L;
  }
  function label(str, start, end) { // lower-third chip that slides in from the left
    var bg = comp.layers.addShape(); bg.name = "chip " + str;
    var g = bg.property("Contents").addProperty("ADBE Vector Group");
    var r = g.property("Contents").addProperty("ADBE Vector Shape - Rect"); r.property("Size").setValue([str.length * 26 + 60, 70]);
    g.property("Contents").addProperty("ADBE Vector Graphic - Fill").property("Color").setValue(RUST);
    bg.inPoint = start; bg.outPoint = end;
    var p = bg.property("Position"); p.setValueAtTime(start, [-400, H - 140]); p.setValueAtTime(start + 0.4, [str.length * 13 + 110, H - 140]); ease(p);
    var t = text(str, 40, [0.1, 0.05, 0.02], [str.length * 13 + 110, H - 128], start + 0.15, end);
    return [bg, t];
  }
  function flash(at) {
    var s = comp.layers.addSolid([1, 1, 1], "flash", W, H, 1, 0.5); s.startTime = at - 0.05;
    var o = s.property("Opacity"); o.setValueAtTime(at, 90); o.setValueAtTime(at + 0.45, 0);
  }
  function shake(L, at) { // wiggle position for 0.5s on impact
    L.property("Position").expression = "t=time-" + at + "; (t>0&&t<0.5)? wiggle(30,40*(1-t/0.5)) : value";
  }

  // 0 HOOK
  var bg0 = comp.layers.addSolid([0.05, 0.06, 0.05], "bg", W, H, 1, DUR);
  text("What if Minecraft TNT", 86, INK, [W / 2, H / 2 - 60], 0.2, 2.5);
  text("leaked into The Last of Us?", 86, MOSS, [W / 2, H / 2 + 60], 0.9, 2.5);
  // 1 BLOCKS
  clip("blocks", IN.blocks, 2.5, 7); label("B · block mode", 2.8, 6.8);
  // 2 SQUAD
  clip("squad", IN.squad, 7, 11); label("5 AI agents. 5 TNT tests.", 7.2, 10.8);
  // 3 BOOM
  var boom = clip("boom", IN.boom, 11, 14.5); flash(12.2); shake(boom, 12.2);
  text("chain reaction: 4/4", 64, INK, [W / 2, 160], 12.4, 14.4);
  // 4 ASK
  clip("ask", IN.ask, 14.5, 17.5); label("an agent asks to patch the engine", 14.7, 17.3);
  var c = text("4/5 green", 96, RUST, [W - 330, 170], 14.8, 17.5);
  c.property("Source Text").setValueAtTime(16.4, (function () { var t = c.property("Source Text").value; t.text = "5/5 green"; t.fillColor = MOSS; return t; })());
  // 5 END
  var lg = text("OVER", 180, INK, [W / 2 - 230, H / 2 - 40], 17.6, 20); var lg2 = text("GROWTH", 180, MOSS, [W / 2 + 330, H / 2 - 40], 17.75, 20);
  text("play free · github.com/Arnie016/overgrowth", 44, INK, [W / 2, H / 2 + 110], 18.2, 20);

  comp.openInViewer();
  app.endUndoGroup();
  alert("Built Overgrowth_Trailer. Adjust IN at the top of the script to line up your clips, then re-run.");
})();
