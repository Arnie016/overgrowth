/* Overgrowth — Higgsfield asset layer: rigged characters, animation clips, props, textures.
   The game keeps its own logic; this only swaps in real models and drives their animations. */
(function () {
  'use strict';
  const HF = (window.HF = { ready: false, chars: {}, clips: {}, props: {}, tex: {}, mixers: [] });
  const CLIPS = {
    survivor: { idle: 'survivor_Idle', walk: 'survivor_walking_2_inplace', run: 'survivor_run_fast_3_inplace', crouch: 'survivor_Cautious_Crouch_Walk_Forward_inplace', throw: 'survivor_Female_Crouch_Pick_Throw_Forward' },
    runner: { idle: 'runner_Idle', walk: 'clicker_Slow_Orc_Walk_inplace', run: 'runner_Standard_Forward_Charge_inplace', scream: 'runner_Zombie_Scream', attack: 'runner_Punch_Forward_with_Both_Fists', death: 'runner_Shot_and_Fall_Backward', stagger: 'clicker_Mummy_Stagger_inplace' },
    clicker: { idle: 'clicker_Idle', walk: 'clicker_Slow_Orc_Walk_inplace', run: 'runner_Standard_Forward_Charge_inplace', scream: 'clicker_Zombie_Scream', attack: 'clicker_Punch_Forward_with_Both_Fists', death: 'clicker_Shot_and_Blown_Back', stagger: 'clicker_Mummy_Stagger_inplace' },
  };
  const PROPS = ['sedan', 'barrel', 'crate', 'dumpster', 'fungus_cluster', 'fungus_column', 'fungal_cocoon', 'generator', 'boiler', 'sofa', 'wardrobe', 'kitchen_table', 'pharmacy_shelf', 'pharmacy_counter', 'plank'];
  const TEX = ['asphalt_wet', 'brick_wet', 'fungal_wall', 'fungal_mat_floor', 'concrete_interior', 'steel_door'];

  // the artifact host serves binaries only under web types, so deployed copies carry a .wasm suffix
  const SUFFIX = /^(localhost|127\.)/.test(location.hostname) ? '' : '.wasm';
  function loadGLB(loader, url) {
    url += SUFFIX;
    return new Promise((res) => loader.load(url, res, undefined, () => res(null)));
  }
  HF.load = async function (renderer, onProgress) {
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils) return;
    const loader = new THREE.GLTFLoader();
    const jobs = [];
    let done = 0;
    const tick = () => onProgress && onProgress(++done / total);
    ['survivor', 'runner', 'clicker'].forEach((n) => jobs.push(loadGLB(loader, `assets/chars/${n}.glb`).then((g) => { if (g) HF.chars[n] = g.scene; tick(); })));
    const clipNames = new Set();
    Object.values(CLIPS).forEach((m) => Object.values(m).forEach((c) => clipNames.add(c)));
    clipNames.forEach((c) => jobs.push(loadGLB(loader, `assets/anims/${c}.glb`).then((g) => { if (g && g.animations[0]) HF.clips[c] = g.animations[0]; tick(); })));
    PROPS.forEach((p) => jobs.push(loadGLB(loader, `assets/props/${p}.glb`).then((g) => { if (g) HF.props[p] = normalizeProp(g.scene); tick(); })));
    const tl = new THREE.TextureLoader(), aniso = renderer.capabilities.getMaxAnisotropy();
    TEX.forEach((t) => jobs.push(new Promise((res) => tl.load(`assets/tex/${t}.jpg`, (tx) => { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.encoding = THREE.sRGBEncoding; tx.anisotropy = Math.min(8, aniso); HF.tex[t] = tx; tick(); res(); }, undefined, () => { tick(); res(); }))));
    const total = jobs.length;
    await Promise.all(jobs);
    Object.values(HF.chars).forEach((s) => s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true;  if (o.material) { o.material.roughness = 0.85; o.material.metalness = 0; } } }));
    HF.ready = Object.keys(HF.chars).length > 0;
  };
  // centre a prop on the ground and remember its footprint
  function normalizeProp(s) {
    s.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(s), c = box.getCenter(new THREE.Vector3());
    s.position.x -= c.x; s.position.z -= c.z; s.position.y -= box.min.y;
    const g = new THREE.Group(); g.add(s);
    g.userData.size = box.getSize(new THREE.Vector3());
    return g;
  }
  // a prop scaled so its longest horizontal side is `len` metres
  HF.prop = function (name, len) {
    const src = HF.props[name];
    if (!src) return null;
    const g = src.clone(true), s = src.userData.size;
    const k = len / Math.max(s.x, s.z);
    g.scale.setScalar(k);
    g.userData.half = { x: (s.x * k) / 2, z: (s.z * k) / 2, h: s.y * k };
    return g;
  };

  // attach a rigged character to an existing game group; hides the old primitive meshes but keeps
  // them for hit tests. Returns a controller with play(state).
  HF.attach = function (group, kind, opts = {}) {
    const srcKind = kind === 'bloater' ? 'clicker' : kind === 'ellie' ? 'survivor' : kind;
    const src = HF.chars[srcKind];
    if (!src) return null;
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    group.traverse((o) => { if (o.isMesh && !o.userData.keep) o.material = hidden; });
    const model = THREE.SkeletonUtils.clone(src);
    model.rotation.y = Math.PI; // models face +z, the game faces -z
    if (opts.scale) model.scale.setScalar(opts.scale);
    if (opts.tint) model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(opts.tint)); } });
    model.traverse((o) => { if (o.isMesh) o.userData.e = group.userData.e; });
    group.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const map = CLIPS[srcKind];
    const actions = {};
    Object.keys(map).forEach((k) => { const c = HF.clips[map[k]]; if (c) actions[k] = mixer.clipAction(c); });
    ['attack', 'scream', 'throw', 'death'].forEach((k) => { if (actions[k]) { actions[k].setLoop(THREE.LoopOnce); actions[k].clampWhenFinished = true; } });
    let cur = null;
    const ctl = {
      model, mixer, actions, state: null,
      play(state, fade = 0.25, speed = 1) {
        const a = actions[state] || actions.idle;
        if (!a) return;
        a.timeScale = speed;
        if (cur === a) return;
        a.reset().fadeIn(fade).play();
        if (cur) cur.fadeOut(fade);
        cur = a;
        ctl.state = state;
      },
      busy() { return cur && cur.loop === THREE.LoopOnce && cur.isRunning(); },
    };
    mixer.timeScale = 0.9 + Math.random() * 0.2;
    ctl.play('idle', 0);
    mixer.update(Math.random() * 3);
    HF.mixers.push({ mixer, group });
    return ctl;
  };
  HF.update = function (dt) { for (let i = 0; i < HF.mixers.length; i++) { const m = HF.mixers[i]; if (m.group.visible) m.mixer.update(dt); } };
})();
