"use strict";

// 3D avatar viewer for Tripo3D-generated heads. Loads three.js on demand from
// a CDN and renders /models/avatar_head.glb on a WebGL canvas layered over the
// 2D stage. Falls back silently (available=false) when the model or CDN is
// unreachable, in which case callers keep using the 2D canvas renderer.
const VisualActorAvatar3D = (() => {
  const THREE_URL = "three";
  const GLTF_URL = "three/addons/loaders/GLTFLoader.js";
  const MODEL_URL = "/models/avatar_head.glb";
  const DEG = Math.PI / 180;

  function findMorphIndex(mesh, names) {
    const dict = mesh.morphTargetDictionary;
    if (!dict) return -1;
    const keys = Object.keys(dict);
    for (const wanted of names) {
      for (const key of keys) {
        if (key.toLowerCase().includes(wanted)) return dict[key];
      }
    }
    return -1;
  }

  function findBone(root, names) {
    let found = null;
    root.traverse((node) => {
      if (found || !node.isBone) return;
      const name = node.name.toLowerCase();
      if (names.some((wanted) => name.includes(wanted))) found = node;
    });
    return found;
  }

  class Viewer {
    constructor(three, gltf, canvas) {
      this.three = three;
      this.canvas = canvas;
      this.renderer = new three.WebGLRenderer({ canvas, alpha: true, antialias: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = three.SRGBColorSpace;
      this.renderer.toneMapping = three.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;

      this.scene = new three.Scene();
      this.camera = new three.PerspectiveCamera(28, 1, 0.05, 50);

      const key = new three.DirectionalLight(0xfff1e0, 2.4);
      key.position.set(-1.4, 1.6, 2.2);
      const fill = new three.DirectionalLight(0x9db8ff, 0.9);
      fill.position.set(1.8, 0.4, 1.4);
      const rim = new three.DirectionalLight(0x8fd8ff, 1.4);
      rim.position.set(0.4, 1.2, -2.2);
      const ambient = new three.AmbientLight(0x404860, 1.2);
      this.scene.add(key, fill, rim, ambient);

      this.root = new three.Group();
      this.scene.add(this.root);
      // Tripo3D exports face along +X; turn the bust toward the camera (+Z).
      gltf.scene.rotation.y = -Math.PI / 2;
      this.root.add(gltf.scene);
      this.frameModel(gltf.scene);

      this.jawBone = findBone(gltf.scene, ["jaw", "chin"]);
      this.headBone = findBone(gltf.scene, ["head", "neck"]);
      this.morphMeshes = [];
      gltf.scene.traverse((node) => {
        if (node.isMesh && node.morphTargetInfluences && node.morphTargetInfluences.length) {
          this.morphMeshes.push({
            mesh: node,
            jawOpen: findMorphIndex(node, ["jawopen", "mouthopen", "jaw_open", "a"]),
            blink: findMorphIndex(node, ["blink", "eyesclosed", "eye_close"]),
            smile: findMorphIndex(node, ["smile", "mouthsmile"]),
          });
        }
      });

      this.mouthOpen = 0;
      this.nod = 0;

      const gl = this.renderer.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const glName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      this.softwareGL = /swiftshader|llvmpipe|software/i.test(glName);
    }

    frameModel(model) {
      const three = this.three;
      const box = new three.Box3().setFromObject(model);
      const size = box.getSize(new three.Vector3());
      const center = box.getCenter(new three.Vector3());
      model.position.sub(center);
      // Aim the camera at the upper third of the bust, where the face is.
      const faceY = size.y * 0.26;
      const dist = Math.max(size.x, size.y) * 2.4;
      this.camera.position.set(0, faceY, dist);
      this.camera.lookAt(0, faceY, 0);
    }

    resize(width, height) {
      if (!width || !height) return;
      // Cap the render buffer; CSS scales the canvas up, keeping software
      // rasterizers (no-GPU machines) usable with minimal quality loss.
      const maxDim = this.softwareGL ? 420 : 1280;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      if (this.canvas.width === w && this.canvas.height === h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    render(pose, audioLevel, tMs) {
      const jaw = Math.max(0, Math.min(1, pose.jawOpen || 0));
      this.mouthOpen += (jaw - this.mouthOpen) * 0.45;

      const blink = Math.max(pose.eyeBlinkLeft || 0, pose.eyeBlinkRight || 0);
      let morphDrove = false;
      for (const m of this.morphMeshes) {
        const inf = m.mesh.morphTargetInfluences;
        if (m.jawOpen >= 0) {
          inf[m.jawOpen] = this.mouthOpen;
          morphDrove = true;
        }
        if (m.blink >= 0) inf[m.blink] = blink;
        if (m.smile >= 0) inf[m.smile] = Math.max(pose.mouthSmileLeft || 0, pose.mouthSmileRight || 0) * 0.6;
      }
      if (this.jawBone) {
        this.jawBone.rotation.x = this.mouthOpen * 14 * DEG;
        morphDrove = true;
      }

      // Natural speaking motion: head drift always, plus a subtle syllable nod
      // when the model has no jaw rig to show mouth movement directly.
      const yaw = (pose.headYaw || 0) * DEG;
      const pitch = (pose.headPitch || 0) * DEG;
      const roll = (pose.headRoll || 0) * DEG;
      const talkNod = morphDrove ? 0 : this.mouthOpen * 2.4 * DEG;
      this.nod += (talkNod - this.nod) * 0.3;
      const sway = Math.sin(tMs * 0.0006) * 0.8 * DEG;

      const target = this.headBone || this.root;
      target.rotation.set(pitch + this.nod, yaw + sway, roll);
      this.root.position.y = Math.sin(tMs * 0.0011) * 0.004 + (pose.breath || 0) * 0.01;

      this.renderer.render(this.scene, this.camera);
    }
  }

  async function load(canvas) {
    const head = await fetch(MODEL_URL, { method: "HEAD" });
    if (!head.ok) throw new Error(`model not available: ${head.status}`);
    const [three, gltfModule] = await Promise.all([import(THREE_URL), import(GLTF_URL)]);
    const loader = new gltfModule.GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.load(MODEL_URL, resolve, undefined, reject));
    return new Viewer(three, gltf, canvas);
  }

  return { load };
})();

window.VisualActorAvatar3D = VisualActorAvatar3D;
