// "All games are open source now": 60s meme-style edit builder for After Effects.
// File > Scripts > Run Script File..., then pick the era_video folder (the one holding assets/).
// Builds a 1080x1920 vertical comp (set VERTICAL=false for 1920x1080). Every layer stays editable.
// Missing assets become labelled placeholders, so the timing can be judged before footage exists.
var VERTICAL = true;
var CREDITS = { gta: "@creator", skate: "@creator", halo: "@creator", darksouls: "@creator", league: "@creator", zombies: "@creator", overgrowth: "Overgrowth · github.com/Arnie016/overgrowth" };

(function () {
  app.beginUndoGroup("Era video");
  var root = Folder.selectDialog("Pick the era_video folder (contains assets/)");
  if (!root) return;
  var A = root.fsName + "/assets/";
  var W = VERTICAL ? 1080 : 1920, H = VERTICAL ? 1920 : 1080, FPS = 30, DUR = 60;
  var comp = app.project.items.addComp("Era_60s", W, H, 1, DUR, FPS);
  comp.motionBlur = true;
  var INK = [1, 1, 1], YEL = [1, 0.85, 0.2], RED = [0.9, 0.12, 0.1], BLK = [0, 0, 0];

  function file(sub, name, exts) {
    for (var i = 0; i < exts.length; i++) { var f = new File(A + sub + "/" + name + exts[i]); if (f.exists) return f; }
    return null;
  }
  function imp(f) { try { return app.project.importFile(new ImportOptions(f)); } catch (e) { return null; } }
  function ease(prop) {
    for (var k = 1; k <= prop.numKeys; k++) {
      var t = prop.propertyValueType, n = (t == PropertyValueType.ThreeD_SPATIAL || t == PropertyValueType.TwoD_SPATIAL || t == PropertyValueType.OneD) ? 1 : prop.value.length;
      var e = []; for (var d = 0; d < n; d++) e.push(new KeyframeEase(0, 80));
      try { prop.setTemporalEaseAtKey(k, e, e); } catch (x) {}
    }
  }
  function placeholder(label, s, e) {
    var L = comp.layers.addSolid([0.12, 0.12, 0.14], "MISSING " + label, W, H, 1, e - s); L.startTime = s;
    text("[ " + label + " ]", 60, [0.6, 0.6, 0.6], [W / 2, H / 2], s, e, false);
    return L;
  }
  // footage with a punch-in at the start and a slow push for the rest of the beat
  function clip(name, s, e) {
    var f = file("clips", name, [".mp4", ".mov"]); var it = f && imp(f);
    if (!it) return placeholder(name + ".mp4", s, e);
    var L = comp.layers.add(it); L.startTime = s; L.outPoint = e; L.motionBlur = true;
    var k = 100 * Math.max(W / it.width, H / it.height), sc = L.property("Scale");
    sc.setValueAtTime(s, [k * 1.25, k * 1.25]); sc.setValueAtTime(s + 0.25, [k * 1.02, k * 1.02]); sc.setValueAtTime(e, [k * 1.1, k * 1.1]); ease(sc);
    if (CREDITS[name]) text(CREDITS[name], 26, [0.85, 0.85, 0.85], [W - 40, 70], s, e, false, ParagraphJustification.RIGHT_JUSTIFY);
    return L;
  }
  function text(str, size, color, pos, s, e, pop, just) {
    var L = comp.layers.addText(str), td = L.property("Source Text").value;
    td.fontSize = size; td.fillColor = color; td.justification = just || ParagraphJustification.CENTER_JUSTIFY;
    td.applyStroke = true; td.strokeColor = BLK; td.strokeWidth = Math.max(2, size / 12); td.strokeOverFill = false;
    try { td.font = "Montserrat-ExtraBold"; } catch (x) {}
    L.property("Source Text").setValue(td); L.property("Position").setValue(pos);
    L.inPoint = s; L.outPoint = e;
    if (pop !== false) {
      var sc = L.property("Scale"); sc.setValueAtTime(s, [40, 40]); sc.setValueAtTime(s + 0.12, [112, 112]); sc.setValueAtTime(s + 0.22, [100, 100]); ease(sc);
      var r = L.property("Rotation"); r.setValueAtTime(s, -6); r.setValueAtTime(s + 0.2, 0); ease(r);
    }
    return L;
  }
  // lower-third caption: small, inside the safe area, never covering the footage
  function cap(str, s, e, color) { return text(str, VERTICAL ? 58 : 52, color || INK, [W / 2, H * (VERTICAL ? 0.78 : 0.86)], s, e); }
  function card(name, s, e, y) { // tweet screenshot: pop with overshoot, then a gentle float
    var f = file("tweets", name, [".png", ".jpg"]); var it = f && imp(f);
    if (!it) return text("[ tweet: " + name + ".png ]", 48, INK, [W / 2, y || H * 0.42], s, e);
    var L = comp.layers.add(it); L.startTime = s; L.outPoint = e; L.motionBlur = true;
    var k = 100 * (W * 0.86) / it.width, sc = L.property("Scale"), p = L.property("Position");
    sc.setValueAtTime(s, [k * 0.3, k * 0.3]); sc.setValueAtTime(s + 0.18, [k * 1.08, k * 1.08]); sc.setValueAtTime(s + 0.3, [k, k]); ease(sc);
    p.setValue([W / 2, y || H * 0.42]); p.expression = "value+[0,Math.sin((time-inPoint)*2)*8]";
    L.property("Effects").addProperty("ADBE Drop Shadow").property("Distance").setValue(20);
    return L;
  }
  function sfx(name, t, vol) {
    var f = file("sfx", name, [".wav", ".mp3"]); var it = f && imp(f); if (!it) return null;
    var L = comp.layers.add(it); L.startTime = t; L.name = "sfx " + name;
    if (vol) L.property("Audio Levels").setValue([vol, vol]);
    return L;
  }
  function flash(t, color, peak) {
    var L = comp.layers.addSolid(color || INK, "flash", W, H, 1, 0.6); L.startTime = t;
    var o = L.property("Opacity"); o.setValueAtTime(t, peak || 85); o.setValueAtTime(t + 0.4, 0);
  }
  function shake(L, s, e, amt) { L.property("Position").expression = "(time>" + s + "&&time<" + e + ")?wiggle(25," + (amt || 30) + "):value"; }
  function music(name, s, e, fadeIn, fadeOut) {
    var f = file("music", name, [".mp3", ".wav"]); var it = f && imp(f); if (!it) return null;
    var L = comp.layers.add(it); L.startTime = s; L.outPoint = e; var a = L.property("Audio Levels");
    a.setValueAtTime(s, [-40, -40]); a.setValueAtTime(s + fadeIn, [-10, -10]); a.setValueAtTime(e - fadeOut, [-10, -10]); a.setValueAtTime(e, [-48, -48]);
    return L;
  }

  // background
  comp.layers.addSolid([0.04, 0.04, 0.05], "bg", W, H, 1, DUR);
  // music beds: funny, then hard cut to zombies, then funny again
  music("funny", 0, 33.05, 0.2, 0.05); music("zombies", 33.0, 40.2, 0.05, 0.4); music("funny", 40.0, 60, 0.3, 1.5);

  // 0 HOOK
  sfx("record_scratch", 0.0); text("It took the internet", 78, INK, [W / 2, H * 0.40], 0.1, 1.6); text("ONE WEEK.", 150, YEL, [W / 2, H * 0.50], 0.5, 1.6);
  text("All games are", 90, INK, [W / 2, H * 0.42], 1.6, 3.0); text("open source now.", 110, YEL, [W / 2, H * 0.52], 1.9, 3.0); sfx("vine_boom", 1.9); flash(1.9);
  // 1 TWEET
  sfx("whoosh", 3.0); card("main", 3.0, 8.0); sfx("ding", 3.3); cap("2.6k stars. In days. For a repo that mods ANY game.", 4.0, 8.0);
  // 2 GTA x MINECRAFT
  var g = clip("gta", 8, 14); cap("Minecraft. Inside GTA V.", 8.1, 10.8); cap("TNT blows up REAL GTA cars.", 10.8, 14, YEL); sfx("bruh", 12.0); shake(g, 12, 12.6);
  // 3 MW2 x SKATE 3
  clip("skate", 14, 19); sfx("whoosh", 14); cap("Kickflip. No-scope. Same game.", 14.1, 16.8); cap("Physics has left the chat.", 16.8, 19); sfx("airhorn", 16.8, -6);
  // 4 MARIO x HALO
  clip("halo", 19, 24); cap("Mario. In Halo.", 19.1, 21.5); cap("Nintendo's lawyers have entered the building.", 21.5, 24, YEL); sfx("dun_dun", 21.5);
  // 5 DARK SOULS
  clip("darksouls", 24, 29); cap("Someone gave Dark Souls an AI mod…", 24.1, 27); cap("…you still die.", 27, 29, RED); sfx("sad_trombone", 27);
  // 6 LEAGUE
  clip("league", 29, 33); cap("League of Legends, now with AI agents.", 29.1, 31.2); cap("Still toxic. Some things can't be patched.", 31.2, 33); sfx("bruh", 31.4);
  // 7 TONE SHIFT: COD ZOMBIES
  var z = clip("zombies", 33, 40); flash(33, RED, 90); sfx("alarm", 33); sfx("round_change", 33.4); shake(z, 33, 34.2, 45);
  try { z.property("Effects").addProperty("ADBE Tint"); var cc = z.property("Effects").addProperty("ADBE Vignette"); } catch (x) {}
  text("ROUND 1", 170, RED, [W / 2, H * 0.40], 33.4, 36); cap("the agents are inside the code now", 35.5, 40, RED);
  // 8 OUR BUILD
  clip("overgrowth", 40, 46); sfx("pop", 40); cap("Meanwhile I gave 5 AI agents TNT.", 40.1, 42.8);
  cap("4/5 passed. The 5th asked permission first.", 42.8, 44.8, YEL); cap("More polite than my teammates.", 44.8, 46); sfx("villager", 43);
  // 9 REPLIES
  card("reply1", 46.0, 52, H * 0.30); sfx("pop", 46.0); card("reply2", 47.8, 52, H * 0.50); sfx("pop", 47.8); card("reply3", 49.6, 52, H * 0.70); sfx("pop", 49.6);
  // 10 THE ERA: rapid montage, cutting every 0.6s through all clips
  var names = ["gta", "skate", "halo", "darksouls", "league", "zombies", "overgrowth", "gta"];
  for (var i = 0; i < names.length; i++) clip(names[i], 52 + i * 0.6, 52 + (i + 1) * 0.6);
  sfx("riser", 52); text("Game modding just entered", 72, INK, [W / 2, H * 0.42], 54.0, 57); text("A NEW ERA.", 140, YEL, [W / 2, H * 0.52], 55.2, 57); sfx("vine_boom", 55.2); flash(55.2);
  // 11 CTA
  text("Which game gets ripped open next?", 64, INK, [W / 2, H * 0.40], 57, 60); text("COMMENT 👇", 120, YEL, [W / 2, H * 0.50], 57.4, 60);
  text("Follow for more deep dives", 50, INK, [W / 2, H * 0.60], 57.8, 60); sfx("click", 57.8); sfx("ding", 58.0);

  comp.openInViewer();
  app.endUndoGroup();
  alert("Built Era_60s. Missing assets show as grey placeholders; drop files into assets/ and re-run.");
})();
