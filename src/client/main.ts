import { zoneAtTime } from '../shared/zone';
import { OperatorModel, OperatorPose } from './world/OperatorModel';
import * as THREE from 'three';
import './ui/combat.css';
import { playerHit } from '../shared/combat';
import { CombatAtmosphere } from './world/CombatAtmosphere';
import { AshenValleyMap } from './world/AshenValleyMap';
import { BuildingGenerator } from './world/BuildingGenerator';
import { VehicleManager } from './world/VehicleManager';
import { StormVisuals } from './world/StormVisuals';
import { LobbyShowcaseStage } from './world/LobbyShowcaseStage';
import { TrainingGroundMap } from './world/TrainingGroundMap';
import { DropPlane } from './world/DropPlane';
import { GrassField } from './world/GrassField';
import { PostFX } from './world/PostFX';
import { SUN_DIRECTION, SUN_COLOR, FOG_COLOR } from './world/Environment';

import { SoundManager } from './game/SoundManager';
import { PlayerController } from './game/PlayerController';
import { CombatSystem, ShotResult } from './game/CombatSystem';
import { InventorySystem, lootLabel, RARITY_COLORS } from './game/InventorySystem';
import { ParticleSystem } from './game/ParticleSystem';

import { LoadingScreenUI } from './ui/LoadingScreenUI';
import { CharacterCreationUI, UserProfile } from './ui/CharacterCreationUI';
import { LobbyUI } from './ui/LobbyUI';
import { MapSelectUI, AVAILABLE_MAPS } from './ui/MapSelectUI';
import { GameHUD } from './ui/GameHUD';
import { TacticalMapUI } from './ui/TacticalMapUI';
import { ResultsUI } from './ui/ResultsUI';
import { InventoryUI } from './ui/InventoryUI';
import { fitPickedAttachment, moveAttachment, removeWeapon, swapSlots } from '../shared/loadout';

import { ClientPacket, ServerPacket, PlayerState, ZoneState, LootItem, KillFeedEntry, WeaponId, AttachmentType, Rarity } from '../shared/types';
import { ATTACHMENT_INFO, ZONE_PHASES, POI_LOCATIONS, WEAPONS } from '../shared/constants';

// Fallback landing spot (Old Town) used if the drop is skipped.
const SOLO_SPAWN = { x: -1570, z: -1170 };
const HEAL_TIMES = { bandage: 3, medkit: 6 } as const;
const BOT_WEAPONS: WeaponId[] = ['viper_ar', 'viper_ar', 'rook_smg', 'rook_smg', 'sentinel_dmr', 'hammer_shotgun'];

type HealType = 'medkit' | 'bandage';

class DropzoneGame {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private sunLight!: THREE.DirectionalLight;

  private map: AshenValleyMap;
  private trainingGroundMap: TrainingGroundMap;
  private buildingGenerator: BuildingGenerator;
  private vehicleManager: VehicleManager;
  private stormVisuals: StormVisuals;
  private lobbyShowcaseStage: LobbyShowcaseStage;
  private dropPlane: DropPlane;
  private grass: GrassField;
  private postfx!: PostFX;
  private battleWorldObjects: THREE.Object3D[] = [];

  private soundManager: SoundManager;
  private playerController: PlayerController;
  private combatSystem: CombatSystem;
  private inventorySystem: InventorySystem;
  private particleSystem: ParticleSystem;

  private loadingScreenUI: LoadingScreenUI;
  private characterCreationUI: CharacterCreationUI;
  private lobbyUI: LobbyUI;
  private mapSelectUI: MapSelectUI;
  private gameHUD: GameHUD;
  private tacticalMapUI: TacticalMapUI;
  private resultsUI: ResultsUI;
  private inventoryUI: InventoryUI;

  private socket: WebSocket | null = null;
  private lastFrame = performance.now();
  private networkAccumulator = 0;
  private hudAccumulator = 0;
  private onlineRoster: PlayerState[] = [];
  private onlineLoot: LootItem[] = [];
  private reconnectTimer?: number;
  private pingTimer?: number;
  private onlineCooperative = true;
  private localPlayerId: string = 'local_p1';
  private currentRoomCode: string | null = null;
  private isOfflineSinglePlayer: boolean = false;
  private isGameActive: boolean = false;
  private currentProfile: UserProfile = { name: 'Operator', color: '#617a72', level: 1, xp: 0 };
  private offlineHealth = 100;
  private offlineArmor = 50;
  private offlineMaxArmor = 50;
  private offlineDamage = 0;
  private offlineStartTime = 0;
  private offlineCombatAt = Infinity;
  private offlineBotFireCooldowns = new Map<string, number>();
  private offlineBotWaypoints = new Map<string, THREE.Vector3>();
  private offlineBotAware = new Map<string, number>();
  private offlineLastZoneTick = 0;
  private offlineLastAttacker = '';
  private isTrainingGround = false;
  private trainingHits = 0;
  private lootCounter = 0;
  private heal: { type: HealType; elapsed: number; duration: number } | null = null;

  private remotePlayers: Map<string, OperatorModel> = new Map();
  private offlineBots: PlayerState[] = [];
  private offlineZone!: ZoneState;
  private offlineKillFeed: KillFeedEntry[] = [];
  private offlineLoot: LootItem[] = [];
  private vehicleSyncFrame = 0;
  private atmosphere: CombatAtmosphere;
  private raycaster = new THREE.Raycaster();

  constructor() {
    this.container = document.getElementById('canvas-container')!;

    this.scene = new THREE.Scene();
    this.scene.background = FOG_COLOR.clone();
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00018);

    // Far plane just past the fogged horizon; the sky dome follows the camera inside it.
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5600);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Image-based lighting gives metal, glass and fabric real reflections without washing out shadows.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = pmrem.fromScene(this.createSkyEnvironment(), .02).texture;
    pmrem.dispose();
    this.scene.environment = environment;
    (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = .42;

    // Crisp sunlight with high-resolution shadow frustum; balanced sky fill keeps deep shadow contrast.
    const dirLight = new THREE.DirectionalLight(SUN_COLOR, 5.0);
    this.sunLight = dirLight;
    dirLight.position.set(200, 400, 150);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.00012;
    dirLight.shadow.normalBias = 0.025;
    dirLight.shadow.camera.left = -135;
    dirLight.shadow.camera.right = 135;
    dirLight.shadow.camera.top = 135;
    dirLight.shadow.camera.bottom = -135;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 900;
    this.scene.add(dirLight);
    this.scene.add(dirLight.target);

    const hemiLight = new THREE.HemisphereLight(0x88ccff, 0x345e37, 0.68);
    this.scene.add(hemiLight);

    this.map = new AshenValleyMap(this.scene);
    this.trainingGroundMap = new TrainingGroundMap(this.scene);
    this.buildingGenerator = new BuildingGenerator(this.scene, this.map);
    this.vehicleManager = new VehicleManager(this.scene, this.map);
    this.stormVisuals = new StormVisuals(this.scene);
    this.grass = new GrassField(this.scene, this.map.heightTexture, this.map.segs, this.buildingGenerator.footprints, this.map.roadSegments);
    this.battleWorldObjects = this.scene.children.filter(o => o !== this.camera && !(o instanceof THREE.Light) && o !== this.trainingGroundMap.root);
    this.lobbyShowcaseStage = new LobbyShowcaseStage(this.scene);
    this.battleWorldObjects.forEach(o => o.visible = false);
    this.dropPlane = new DropPlane(this.scene);

    this.soundManager = new SoundManager();
    this.particleSystem = new ParticleSystem(this.scene);
    this.atmosphere = new CombatAtmosphere(this.scene);
    this.playerController = new PlayerController(this.camera, this.renderer.domElement, this.map, this.soundManager);
    this.scene.updateMatrixWorld(true);
    this.playerController.collisionBoxes = this.buildingGenerator.buildings.map(object => new THREE.Box3().setFromObject(object));
    this.inventorySystem = new InventorySystem(this.scene, this.playerController, this.soundManager);
    this.combatSystem = new CombatSystem(this.scene, this.camera, this.playerController, this.soundManager, this.particleSystem, this.inventorySystem);
    this.combatSystem.viewModelScene.environment = environment;
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.combatSystem.viewModelScene, this.combatSystem.viewModelCamera);

    const uiRoot = document.getElementById('ui-root')!;
    this.loadingScreenUI = new LoadingScreenUI(uiRoot);
    this.characterCreationUI = new CharacterCreationUI(uiRoot);
    this.lobbyUI = new LobbyUI(uiRoot);
    this.mapSelectUI = new MapSelectUI(uiRoot);
    this.gameHUD = new GameHUD(uiRoot);
    this.gameHUD.hide();
    this.tacticalMapUI = new TacticalMapUI(uiRoot);
    this.tacticalMapUI.onVisibilityChange = visible => { this.playerController.canLock = !visible; };
    this.resultsUI = new ResultsUI(uiRoot);
    this.inventoryUI = new InventoryUI(uiRoot);

    this.currentProfile = this.characterCreationUI.getSavedProfile() || this.currentProfile;
    this.lobbyUI.setProfile(this.currentProfile);
    this.lobbyShowcaseStage.createCharacterMesh(this.currentProfile.color, this.currentProfile.skin, this.currentProfile.outfit);
    this.lobbyShowcaseStage.setWeapon(this.currentProfile.weaponId || 'viper_ar',this.currentProfile.opticId);
    this.lobbyShowcaseStage.setVisible(true);
    this.combatSystem.setSleeveColor(this.currentProfile.color);

    // Pre-warm world vehicles, loot, and GPU shaders during startup so clicking PLAY is 100% instant
    this.vehicleManager.spawnOfflineVehicles();
    this.offlineLoot = [
      this.makeLoot('weapon', SOLO_SPAWN.x + 4, SOLO_SPAWN.z, { weaponId: 'rook_smg' }),
      this.makeLoot('armor', SOLO_SPAWN.x - 4, SOLO_SPAWN.z, { armorValue: 50, rarity: 'uncommon' }),
      this.makeLoot('healing', SOLO_SPAWN.x, SOLO_SPAWN.z + 5, { healType: 'medkit', rarity: 'rare' }),
      this.makeLoot('ammo', SOLO_SPAWN.x + 2, SOLO_SPAWN.z - 5, { ammoType: 'Rifle Ammo', ammoAmount: 60 }),
      ...this.generateOfflineLoot()
    ];
    this.inventorySystem.updateWorldLoot(this.offlineLoot);
    this.renderer.compile(this.scene, this.camera);
    for (const m of this.inventorySystem.lootMeshes.values()) m.visible = false;
    for (const v of this.vehicleManager.vehicles.values()) v.visible = false;

    this.setupNetwork();
    this.bindCallbacks();
    this.initResizeListener();
    this.initLoadingFlow();
    this.animate();
  }

  /** Outdoor reflection probe: vibrant blue sky, bright sun, rich foliage ground. */
  private createSkyEnvironment(): THREE.Scene {
    const envScene = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec3 vDir; void main(){
        float h = vDir.y;
        vec3 ground = vec3(.14,.24,.15), horizon = vec3(.58,.84,.96), zenith = vec3(.10,.36,.72);
        vec3 c = h < 0. ? mix(horizon*.65, ground, smoothstep(0., .35, -h)) : mix(horizon, zenith, smoothstep(0., .6, h));
        float sun = pow(max(0., dot(vDir, normalize(vec3(.62,.45,.36)))), 64.);
        gl_FragColor = vec4(c + vec3(1.,.92,.74) * sun * 3.2, 1.); }`
    }));
    envScene.add(sky);
    return envScene;
  }

  private initLoadingFlow(): void {
    this.loadingScreenUI.simulateLoading(() => {
      const profile = this.characterCreationUI.getSavedProfile();
      if (!profile) this.characterCreationUI.show();
      else this.lobbyUI.show();
    });
  }

  private setupNetwork(): void {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = import.meta.env.VITE_GAME_SERVER_URL || `${protocol}//${window.location.host}/ws`;
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.lobbyUI.setNetworkStatus('MATCH SERVER ONLINE');
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => this.sendPacket({ type: 'PING', sentAt: Date.now() }), 2500);
      };

      this.socket.onmessage = (event) => {
        try {
          const packet: ServerPacket = JSON.parse(event.data);
          this.handleServerPacket(packet);
        } catch (err) {
          console.error('Failed to parse packet:', err);
        }
      };

      this.socket.onclose = () => {
        window.clearInterval(this.pingTimer);
        this.lobbyUI.setNetworkStatus('SERVER OFFLINE · SOLO AVAILABLE');
        if (this.currentRoomCode) {
          this.currentRoomCode = null; this.lobbyUI.clearRoom();
          if (this.isGameActive && !this.isOfflineSinglePlayer) {
            this.playerController.enabled = false;
            this.gameHUD.setNetwork('DISCONNECTED');
            this.gameHUD.showLootToast('Connection lost', 'Return to the lobby to create or join a new match.');
            if (document.pointerLockElement) document.exitPointerLock();
          }
        }
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => this.setupNetwork(), 4000);
      };
      this.socket.onerror = () => { console.log('[DROPZONE Client] Offline mode ready'); };
    } catch {
      console.log('[DROPZONE Client] Offline mode active');
    }
  }

  private handleServerPacket(packet: ServerPacket): void {
    switch (packet.type) {
      case 'PONG':
        if (!this.isOfflineSinglePlayer) this.gameHUD.setNetwork(Math.max(0, Date.now() - packet.sentAt) + ' MS');
        break;
      case 'SHOT_FIRED': {
        if (packet.playerId === this.localPlayerId || !this.isGameActive) break;
        const origin = new THREE.Vector3(packet.origin.x, packet.origin.y, packet.origin.z);
        const end = new THREE.Vector3(packet.end.x, packet.end.y, packet.end.z);
        const model = this.remotePlayers.get(packet.playerId);
        model?.fire();
        const muzzle = model?.getMuzzle()?.position ?? origin;
        const dir = end.clone().sub(origin).normalize();
        this.particleSystem.spawnTracer(muzzle, end);
        this.particleSystem.spawnMuzzleFlash(muzzle, dir, .8);
        this.soundManager.playSpatialGunshot(origin, this.playerController.position, WEAPONS[packet.weaponId].category);
        if (packet.hit) this.particleSystem.spawnBloodHit(end, dir);
        else if (end.distanceTo(origin) < WEAPONS[packet.weaponId].range - 1) this.particleSystem.spawnImpactSparks(end, dir.clone().negate(), 'soft');
        this.checkNearMiss(origin, end);
        break;
      }
      case 'HIT_CONFIRMED':
        this.gameHUD.showHitMarker(packet.damage, packet.headshot, packet.eliminated);
        this.soundManager.playHitMarker(packet.headshot, packet.eliminated);
        break;
      case 'PLAYER_DAMAGE_TAKEN': {
        const attacker = this.onlineRoster.find(p => p.id === packet.attackerId);
        const angle = attacker ? Math.atan2(attacker.position.x-this.playerController.position.x, -(attacker.position.z-this.playerController.position.z))+this.playerController.yaw : 0;
        this.gameHUD.showDamageIndicator(packet.attackerName, angle);
        if (packet.attackerName !== 'ZONE') { this.soundManager.playDamageTaken(packet.damage > 30); this.playerController.addShake(packet.damage > 30 ? 2.5 : 1.2); }
        break;
      }
      case 'ROOM_JOINED':
        this.localPlayerId = packet.playerId;
        this.currentRoomCode = packet.roomCode;
        this.lobbyUI.updateRoomState(packet.roomCode, packet.isHost, packet.players);
        break;

      case 'ROOM_UPDATED':
        this.onlineCooperative = packet.isSquad;
        if (this.currentRoomCode) this.lobbyUI.updateRoomState(this.currentRoomCode, this.localPlayerId === packet.players.find(p => p.isHost)?.id, packet.players);
        break;

      case 'ERROR_MESSAGE':
        this.lobbyUI.showError(packet.message);
        break;

      case 'MATCH_STATE_SNAPSHOT':
        this.handleSnapshot(packet);
        break;

      case 'MATCH_OVER_EVENT': {
        this.isGameActive = false;
        this.playerController.enabled = false;
        this.soundManager.setWind(0);
        if (document.pointerLockElement) document.exitPointerLock();
        const mine = packet.stats.find(s => s.playerId === this.localPlayerId);
        if (mine?.placement === 1) this.soundManager.playVictoryFanfare(); else this.soundManager.playDefeat();
        this.applyMatchXp(mine?.xpEarned || 0);
        this.resultsUI.show(packet.winnerName, this.localPlayerId, packet.stats);
        break;
      }

      case 'LOOT_PICKED_UP':
        if (packet.playerId === this.localPlayerId) {
          const item = this.onlineLoot.find(l => l.id === packet.lootId);
          if (item) this.gameHUD.showLootToast(lootLabel(item), item.type === 'attachment' && item.attachmentType ? ATTACHMENT_INFO[item.attachmentType].effect : 'Added to inventory');
        }
        break;
    }
  }

  private handleSnapshot(packet: Extract<ServerPacket, { type: 'MATCH_STATE_SNAPSHOT' }>): void {
    if (packet.phase === 'MATCH_END') return;
    this.combatSystem.serverAuthoritative = true;
    this.onlineRoster = packet.players;
    if (packet.loot) { this.onlineLoot = packet.loot; this.inventorySystem.updateWorldLoot(packet.loot); }
    this.isOfflineSinglePlayer = false; this.isTrainingGround = false; this.playerController.trainingMode = false;
    this.gameHUD.setMode(this.onlineCooperative ? 'SQUAD / AI' : 'FREE-FOR-ALL');
    if (!this.isGameActive) {
      const spawn = packet.players.find(p => p.id === this.localPlayerId);
      if (spawn) {
        this.playerController.position.set(spawn.position.x, spawn.position.y, spawn.position.z);
        this.playerController.isDropping = spawn.isDropping;
        this.inventorySystem.primaryWeapon = spawn.primaryWeapon || spawn.equippedWeapon;
        this.combatSystem.setEquippedWeapon(spawn.equippedWeapon, false);
      }
    }
    this.isGameActive = true;
    if (!this.isTrainingGround) this.battleWorldObjects.forEach(o => o.visible = true);
    this.gameHUD.show();
    this.lobbyShowcaseStage.setVisible(false);
    this.lobbyUI.hide();
    this.stormVisuals.updateZone(packet.zone);
    this.vehicleManager.updateVehicles(packet.vehicles);
    this.updateRemotePlayers(packet.players);

    const localState = packet.players.find(p => p.id === this.localPlayerId);
    if (!localState) return;
    if (localState.vehicleId && !this.playerController.isDriving) {
      const vehicle = packet.vehicles.find(v => v.id === localState.vehicleId);
      if (vehicle) this.playerController.enterVehicle(vehicle.id, new THREE.Vector3(vehicle.position.x, vehicle.position.y + 1.05, vehicle.position.z), vehicle.rotation.yaw);
    } else if (!localState.vehicleId && this.playerController.isDriving) {
      this.playerController.exitVehicle();
    }
    this.playerController.enabled = !localState.isDowned && !localState.isEliminated;
    if (localState.isEliminated && this.heal) this.heal = null;
    this.inventorySystem.activeSlot = localState.activeSlot;
    this.inventorySystem.primaryWeapon = localState.primaryWeapon || null;
    this.inventorySystem.healingItems = localState.healingItems;
    if (this.combatSystem.currentWeapon?.id !== localState.equippedWeapon) this.combatSystem.setEquippedWeapon(localState.equippedWeapon);
    const previousAttachments = JSON.stringify(this.inventorySystem.attachments);
    this.inventorySystem.attachments = localState.attachments;
    this.inventorySystem.ammo = localState.ammo;
    this.inventorySystem.magAmmo = localState.magAmmo;
    this.inventorySystem.secondaryWeapon = localState.secondaryWeapon;
    this.inventorySystem.backpackAttachments = localState.backpackAttachments || [];
    if (this.inventoryUI.isOpen) this.updateInventoryView();
    if (previousAttachments !== JSON.stringify(localState.attachments)) {
      this.combatSystem.setEquippedWeapon(localState.equippedWeapon, false);
      this.lobbyShowcaseStage.setWeapon(localState.equippedWeapon || 'viper_ar', (localState.activeSlot === 1 ? localState.attachments.primary : localState.attachments.secondary).optic || '');
    }
    const squadMembers = packet.players.filter(p => p.squadId === localState.squadId);
    this.gameHUD.update(localState, packet.zone, squadMembers, packet.killFeed, this.playerController.isScoped && this.playerController.firstPerson && this.combatSystem.isMagnifiedOptic, this.playerController.cameraMode, packet.players);
    this.tacticalMapUI.drawMap(localState, packet.players, packet.zone, packet.pings);
  }

  /** A remote round passing near the local player cracks overhead. */
  private checkNearMiss(origin: THREE.Vector3, end: THREE.Vector3): void {
    const me = this.playerController.position;
    const line = new THREE.Line3(origin, end);
    const closest = line.closestPointToPoint(me, true, new THREE.Vector3());
    const distance = closest.distanceTo(me);
    if (distance < 3.5 && distance > .3 && origin.distanceTo(me) > 8) this.soundManager.playBulletWhizBy();
  }

  /** Raycast the world, terrain and operators for shot visuals and offline hits. */
  private resolveShot(origin: THREE.Vector3, direction: THREE.Vector3, range: number): ShotResult {
    let best: ShotResult = { point: origin.clone().addScaledVector(direction, range), normal: direction.clone().negate(), kind: 'none', distance: range };
    if (this.isTrainingGround) {
      this.raycaster.set(origin, direction); this.raycaster.far = range;
      const hit = this.raycaster.intersectObjects(this.trainingGroundMap.targetMeshes)[0];
      if (hit) {
        const isHeadshot = this.trainingGroundMap.registerTargetHit(hit.object);
        best = { point: hit.point, normal: hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? direction.clone().negate(), kind: 'world', distance: hit.distance, surface: 'hard', headshot: isHeadshot };
      } else if (direction.y < 0) {
        const t = (0 - origin.y) / direction.y;
        if (t > 0 && t < range) best = { point: origin.clone().addScaledVector(direction, t), normal: new THREE.Vector3(0, 1, 0), kind: 'world', distance: t, surface: 'soft' };
      }
      return best;
    }
    const sightRay = new THREE.Ray(origin, direction);
    const hitPoint = new THREE.Vector3();
    for (const box of this.playerController.boxesNear(origin.x, origin.z)) {
      if (sightRay.intersectBox(box, hitPoint)) {
        const dist = origin.distanceTo(hitPoint);
        if (dist < best.distance) {
          best = { point: hitPoint.clone(), normal: direction.clone().negate(), kind: 'world', distance: dist, surface: 'hard' };
        }
      }
    }
    // Terrain march with refinement.
    for (let t = 1; t < best.distance; t += 1.5) {
      const x = origin.x + direction.x * t, z = origin.z + direction.z * t;
      if (this.map.getTerrainHeight(x, z) > origin.y + direction.y * t) {
        let lo = t - 1.5, hi = t;
        for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; if (this.map.getTerrainHeight(origin.x + direction.x * mid, origin.z + direction.z * mid) > origin.y + direction.y * mid) hi = mid; else lo = mid; }
        best = { point: origin.clone().addScaledVector(direction, hi), normal: new THREE.Vector3(0, 1, 0), kind: 'world', distance: hi, surface: 'soft' };
        break;
      }
    }
    const players = this.isOfflineSinglePlayer ? this.offlineBots : this.onlineRoster;
    const local = this.onlineRoster.find(p => p.id === this.localPlayerId);
    for (const p of players) {
      if (p.isEliminated || p.id === this.localPlayerId) continue;
      if (!this.isOfflineSinglePlayer && local && this.onlineCooperative && p.squadId === local.squadId) continue;
      const eye = this.isOfflineSinglePlayer ? { ...p.position, y: p.position.y + 1.7 } : p.position;
      const hit = playerHit(origin, direction, eye);
      if (hit && hit.distance < best.distance) best = { point: origin.clone().addScaledVector(direction, hit.distance), normal: direction.clone().negate(), kind: 'player', distance: hit.distance, headshot: hit.headshot };
    }
    return best;
  }

  private bindCallbacks(): void {
    this.characterCreationUI.onSaveProfileCallback = (profile) => {
      this.currentProfile = profile;
      this.lobbyUI.setProfile(profile);
      this.lobbyShowcaseStage.createCharacterMesh(profile.color, profile.skin, profile.outfit);
      this.combatSystem.setSleeveColor(profile.color);
      this.lobbyUI.show();
    };

    this.lobbyUI.onLeaveRoomCallback = () => { this.sendPacket({ type: 'LEAVE_ROOM' }); this.currentRoomCode = null; this.lobbyUI.clearRoom(); };
    this.lobbyUI.onOpenProfileEditCallback = () => { this.characterCreationUI.show(); };
    this.lobbyUI.onSelectWeaponCallback = (weapon, slot) => {
      if (slot === 1) this.currentProfile.weaponId = weapon;
      else this.currentProfile.secondaryWeaponId = weapon;
      localStorage.setItem('dropzone_profile', JSON.stringify(this.currentProfile));
      this.lobbyUI.setProfile(this.currentProfile);
      this.lobbyShowcaseStage.setWeapon(weapon,this.currentProfile.opticId);
    };
    this.lobbyUI.onSelectOpticCallback = (optic) => {
      this.currentProfile.opticId = optic;
      this.lobbyShowcaseStage.setWeapon(this.currentProfile.weaponId || 'viper_ar',optic);
      localStorage.setItem('dropzone_profile', JSON.stringify(this.currentProfile));
      this.lobbyUI.setProfile(this.currentProfile);
    };

    this.lobbyUI.onOpenMapSelectCallback = () => { this.mapSelectUI.show(); };

    this.lobbyUI.onJoinRoomCallback = (code, name, color) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.sendPacket({ type: 'JOIN_ROOM', roomCode: code, playerName: name, characterColor: color, skin: this.currentProfile.skin, outfit: this.currentProfile.outfit, startingWeapon: this.currentProfile.weaponId || 'viper_ar', startingSecondaryWeapon: this.currentProfile.secondaryWeaponId, startingOptic: this.currentProfile.opticId });
      }
      else this.lobbyUI.showError('Squad rooms need the game server. Run npm start and try again.');
    };

    this.mapSelectUI.onDeployMatchCallback = (mapOption) => { this.lobbyUI.setMap(mapOption.name); };
    this.lobbyUI.onStartMatchCallback = () => {
      this.soundManager.initCtx();
      if (this.currentRoomCode) { this.sendPacket({ type: 'START_MATCH' }); return; }
      const mapOption = AVAILABLE_MAPS.find(m=>m.id===this.mapSelectUI.selectedMapId) || AVAILABLE_MAPS[0];
      this.lobbyUI.setMap(mapOption.name);
      if (this.lobbyUI.selectedMode === 'private_room' && mapOption.id === 'training_ground') { this.lobbyUI.showError('Choose Ashen Valley for online matches. Training is a solo range.'); return; }
      this.isTrainingGround = mapOption.id === 'training_ground';
      if (this.isTrainingGround) {
        this.trainingGroundMap.buildTrainingGround();
        this.battleWorldObjects.forEach(o => { o.visible = o.name === 'AtmosphericSky'; });
        this.playerController.trainingMode = true;
        this.playerController.collisionBoxes = this.trainingGroundMap.collisionBoxes;
      } else {
        this.trainingGroundMap.setVisible(false);
        this.playerController.trainingMode = false;
        this.playerController.collisionBoxes = this.buildingGenerator.buildings.map(object => new THREE.Box3().setFromObject(object));
      }

      if (this.lobbyUI.selectedMode === 'private_room') {
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.sendPacket({ type: 'CREATE_ROOM', playerName: this.currentProfile.name, characterColor: this.currentProfile.color, skin: this.currentProfile.skin, outfit: this.currentProfile.outfit, isSquad: this.lobbyUI.cooperative, startingWeapon: this.currentProfile.weaponId || 'viper_ar', startingSecondaryWeapon: this.currentProfile.secondaryWeaponId, startingOptic: this.currentProfile.opticId });
        } else {
          this.lobbyUI.showError('Squad rooms need the game server. Run npm start and try again.');
        }
      } else {
        this.startOfflineSinglePlayerMatch();
      }
    };

    this.combatSystem.resolveShot = (origin, direction, range) => this.resolveShot(origin, direction, range);
    this.combatSystem.getThirdPersonMuzzle = () => {
      const op = this.lobbyShowcaseStage.operator;
      if (!op) return null;
      op.fire();
      return op.getMuzzle();
    };
    this.combatSystem.isBusy = () => !!this.heal || this.playerController.dropStage !== 'none' || this.inventoryUI.isOpen;
    this.inventorySystem.canSwap = () => !this.heal;

    this.combatSystem.onFireCallback = (origin, direction, weaponId, pellets) => {
      if (this.isOfflineSinglePlayer) {
        if (this.isTrainingGround) {
          const hit = this.resolveShot(origin, direction, 500);
          if (hit.kind === 'world' && hit.surface === 'hard') {
            this.trainingHits++;
            const baseDmg = WEAPONS[weaponId]?.damage ?? 34;
            const dmg = Math.round(baseDmg * (hit.headshot ? (WEAPONS[weaponId]?.headshotMultiplier ?? 2) : 1));
            this.gameHUD.showHitMarker(dmg, hit.headshot, false);
            this.soundManager.playHitMarker(hit.headshot, false);
          }
        } else this.processOfflineWeaponFire(origin, direction, weaponId, pellets);
      } else {
        this.sendPacket({ type: 'FIRE_WEAPON', origin: { x: origin.x, y: origin.y, z: origin.z }, direction: { x: direction.x, y: direction.y, z: direction.z }, weaponId });
      }
    };
    this.combatSystem.onReloadCallback = () => { if (!this.isOfflineSinglePlayer) this.sendPacket({ type: 'RELOAD' }); };
    this.inventorySystem.onSwapWeaponCallback = (weaponId, slot) => {
      this.combatSystem.setEquippedWeapon(weaponId);
      const attachments = slot === 1 ? this.inventorySystem.attachments.primary : this.inventorySystem.attachments.secondary;
      this.lobbyShowcaseStage.setWeapon(weaponId, attachments.optic || '');
      if (!this.isOfflineSinglePlayer) this.sendPacket({ type: 'SWAP_WEAPON', slot });
    };

    this.inventorySystem.onPickupLootCallback = (lootId) => {
      if (this.isOfflineSinglePlayer) this.pickupOfflineLoot(lootId);
      else this.sendPacket({ type: 'PICKUP_LOOT', lootId });
    };

    this.inventorySystem.onInteractCallback = () => {
      if (this.playerController.dropStage === 'plane') {
        this.playerController.jumpFromPlane();
        this.deployHotDropBots(this.playerController.position.x, this.playerController.position.z);
        return true;
      }
      const local = this.onlineRoster.find(p => p.id === this.localPlayerId);
      const downed = local && this.onlineRoster.find(p => p.id !== local.id && p.squadId === local.squadId && p.isDowned && Math.hypot(p.position.x-this.playerController.position.x,p.position.z-this.playerController.position.z)<3);
      if (!this.isOfflineSinglePlayer && downed) { this.sendPacket({type:'REVIVE_PLAYER',targetPlayerId:downed.id}); return true; }
      if (!this.isGameActive) return false;
      if (this.playerController.isDriving) {
        if (!this.isOfflineSinglePlayer) this.sendPacket({ type: 'EXIT_VEHICLE' });
        this.playerController.exitVehicle();
        return true;
      }
      // Loot within reach takes priority over a nearby vehicle.
      if (this.inventorySystem.getNearestLoot(this.playerController.position, 2)) return false;
      const nearest = this.vehicleManager.getNearestVehicle(this.playerController.position, 5.2);
      if (!nearest) return false;
      if (this.isOfflineSinglePlayer) {
        this.playerController.enterVehicle(
          nearest.id,
          new THREE.Vector3(nearest.position.x, nearest.position.y + 1.05, nearest.position.z),
          nearest.yaw,
          nearest.type
        );
      } else {
        this.sendPacket({ type: 'ENTER_VEHICLE', vehicleId: nearest.id });
      }
      return true;
    };

    this.tacticalMapUI.onPingCallback = (pos) => {
      this.sendPacket({ type: 'PING_LOCATION', pingType: 'location', position: { x: pos.x, y: 0, z: pos.z } });
    };

    this.resultsUI.onReturnToLobbyCallback = () => this.returnToLobby();
    this.gameHUD.onExitMatchCallback = () => {
      if (this.isTrainingGround) this.returnToLobby();
      else if (this.isOfflineSinglePlayer) this.finishOfflineMatch(false);
      else this.returnToLobby();
    };
    this.gameHUD.onUseHealCallback = (healType) => this.startHeal(healType);

    this.playerController.onLanded = (position) => {
      this.particleSystem.spawnDustBurst(new THREE.Vector3(position.x, position.y - 1.6, position.z), 12, 2.2);
      this.gameHUD.setDropStatus(null);
      if (this.isOfflineSinglePlayer && !this.isTrainingGround) {
        this.offlineCombatAt = Math.min(this.offlineCombatAt, this.gameNow() + 2200);
        this.vehicleManager.ensureLandingVehicle(position.x, position.z);
        this.spawnLandingZoneSupplies(position.x, position.z);
        this.deployHotDropBots(position.x, position.z);
      }
    };

    this.bindInventory();

    window.addEventListener('keydown', (e) => {
      if (!this.isGameActive || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault();
        if (!e.repeat && this.playerController.dropStage === 'none') this.inventoryUI.toggle();
        return;
      }
      if (e.code === 'Escape' && this.inventoryUI.isOpen) { this.inventoryUI.toggle(false); return; }
      if (e.code === 'KeyF') {
        if (this.playerController.dropStage === 'plane') {
          if (!e.repeat) {
            this.playerController.jumpFromPlane();
            this.deployHotDropBots(this.playerController.position.x, this.playerController.position.z);
          }
        }
        else if (!e.repeat) this.combatSystem.attemptFire();
      }
      if (e.repeat) return;
      if (e.code === 'KeyH') this.startHeal('medkit');
      if (e.code === 'KeyJ') this.startHeal('bandage');
      if (e.code === 'KeyB') this.gameHUD.setFireMode(this.combatSystem.fireMode);
    });
  }

  private bindInventory(): void {
    const ui = this.inventoryUI, pc = this.playerController;
    ui.onToggle = open => {
      pc.uiOpen = open;
      if (open) { pc.isScoped = false; if (document.pointerLockElement) document.exitPointerLock(); }
      // Closing with the key is a user gesture, so we can recapture the mouse straight away.
      else if (this.isGameActive && !document.pointerLockElement) this.renderer.domElement.requestPointerLock()?.catch?.(() => { /* click to resume */ });
      this.updateInventoryView();
    };
    ui.onMoveAttachment = (attachment, from, to) => {
      if (this.isOfflineSinglePlayer) { if (moveAttachment(this.inventorySystem, attachment, from, to)) this.refreshHeldWeapon(); }
      else this.sendPacket({ type: 'MOVE_ATTACHMENT', attachment, from, to });
      this.soundManager.playLootPickup('attachment');
    };
    ui.onSwapSlots = () => {
      if (this.isOfflineSinglePlayer) { swapSlots(this.inventorySystem); this.refreshHeldWeapon(); }
      else this.sendPacket({ type: 'SWAP_SLOTS' });
    };
    ui.onDropWeapon = slot => this.dropWeapon(slot);
    ui.onEquip = slot => this.inventorySystem.selectSlot(slot);
    ui.onUseHeal = type => { ui.toggle(false); this.startHeal(type); };
  }

  /** Rebuild the first- and third-person weapon after a loadout change. */
  private refreshHeldWeapon(): void {
    const inv = this.inventorySystem, id = inv.getActiveWeaponId();
    this.combatSystem.setEquippedWeapon(id, false);
    if (id) this.lobbyShowcaseStage.setWeapon(id, (inv.activeSlot === 1 ? inv.attachments.primary : inv.attachments.secondary).optic || '');
    this.updateInventoryView();
  }

  private dropWeapon(slot: 1 | 2): void {
    if (!this.isOfflineSinglePlayer) { this.sendPacket({ type: 'DROP_ITEM', slot }); return; }
    const dropped = removeWeapon(this.inventorySystem, slot);
    if (!dropped) return;
    const here = this.playerController.position, yaw = this.playerController.yaw;
    this.offlineLoot.push(this.makeLoot('weapon', here.x + Math.cos(yaw) * .9, here.z - Math.sin(yaw) * .9, { weaponId: dropped, rarity: WEAPONS[dropped].rarity }));
    this.inventorySystem.updateWorldLoot(this.offlineLoot);
    this.combatSystem.cancelReload();
    this.refreshHeldWeapon();
  }

  private updateInventoryView(): void {
    const inv = this.inventorySystem, { health } = this.currentHealth();
    const me = this.onlineRoster.find(p => p.id === this.localPlayerId);
    this.inventoryUI.update({
      primaryWeapon: inv.primaryWeapon, secondaryWeapon: inv.secondaryWeapon, activeSlot: inv.activeSlot,
      attachments: inv.attachments, magAmmo: inv.magAmmo, ammo: inv.ammo,
      healing: { medkit: inv.healingItems.medkit, bandage: inv.healingItems.bandage }, health,
      armor: this.isOfflineSinglePlayer ? this.offlineArmor : me?.armor ?? 0,
      maxArmor: this.isOfflineSinglePlayer ? this.offlineMaxArmor : me?.maxArmor ?? 100,
      backpack: inv.backpackAttachments
    });
  }

  private currentHealth(): { health: number; max: number } {
    if (this.isOfflineSinglePlayer) return { health: this.offlineHealth, max: 100 };
    const me = this.onlineRoster.find(p => p.id === this.localPlayerId);
    return { health: me?.health ?? 100, max: me?.maxHealth ?? 100 };
  }

  /** Healing is channelled: you move slowly and cannot shoot until it completes. */
  private startHeal(type: HealType): void {
    if (!this.isGameActive || this.heal || !this.playerController.enabled || this.playerController.isDriving || this.playerController.isDropping) return;
    if (this.inventorySystem.healingItems[type] <= 0) { this.gameHUD.showLootToast(`No ${type === 'medkit' ? 'medkits' : 'bandages'}`, 'Search buildings and crates for medical supplies.'); return; }
    const { health, max } = this.currentHealth();
    if (health >= max || (type === 'bandage' && health >= 75)) { this.gameHUD.showLootToast('Health is already high', type === 'bandage' ? 'Bandages heal up to 75 HP.' : 'Medkit is not needed.'); return; }
    this.combatSystem.cancelReload();
    this.heal = { type, elapsed: 0, duration: HEAL_TIMES[type] };
    this.playerController.speedMultiplier = .45;
    this.playerController.isScoped = false;
    this.soundManager.playHealStart(type);
  }

  private updateHeal(delta: number): void {
    if (!this.heal) { this.gameHUD.setAction(null); return; }
    this.heal.elapsed += delta;
    const progress = this.heal.elapsed / this.heal.duration;
    if (progress < 1) { this.gameHUD.setAction(`USING ${this.heal.type.toUpperCase()} · ${(this.heal.duration - this.heal.elapsed).toFixed(1)}s`, progress); return; }
    const type = this.heal.type;
    this.heal = null;
    this.playerController.speedMultiplier = 1;
    this.gameHUD.setAction(null);
    this.soundManager.playHealComplete();
    if (this.isOfflineSinglePlayer) {
      this.inventorySystem.healingItems[type]--;
      this.offlineHealth = type === 'medkit' ? 100 : Math.min(75, this.offlineHealth + 25);
    } else this.sendPacket({ type: 'USE_HEAL', healType: type });
  }

  private nextLootId(prefix: string): string { return `${prefix}_${++this.lootCounter}`; }

  private makeLoot(type: LootItem['type'], x: number, z: number, extra: Partial<LootItem>): LootItem {
    return { id: this.nextLootId(type), type, rarity: 'common', position: { x, y: this.map.getTerrainHeight(x, z), z }, ...extra };
  }

  /** Spread weapons, ammo, meds, armor and attachments around each POI and roadside homesteads. */
  private generateOfflineLoot(): LootItem[] {
    const loot: LootItem[] = [];
    const weapons = Object.keys(WEAPONS) as WeaponId[];
    const attachments = Object.keys(ATTACHMENT_INFO) as AttachmentType[];
    const ammoTypes = ['Rifle Ammo', 'Rifle Ammo', 'SMG Ammo', 'Shotgun Shells', 'Sniper Ammo'];
    for (const [p, poi] of POI_LOCATIONS.entries()) for (let i = 0; i < 32; i++) {
      const angle = i * 2.399963 + p, radius = 8 + Math.sqrt(i / 32) * poi.radius * .48;
      const x = poi.x + Math.cos(angle) * radius, z = poi.z + Math.sin(angle) * radius;
      const roll = (i * 37 + p * 11) % 100;
      if (roll < 26) { const weaponId = weapons[(i + p) % weapons.length]; loot.push(this.makeLoot('weapon', x, z, { weaponId, rarity: WEAPONS[weaponId].rarity })); }
      else if (roll < 58) { const ammoType = ammoTypes[(i * 3 + p) % ammoTypes.length]; loot.push(this.makeLoot('ammo', x, z, { ammoType, ammoAmount: ammoType === 'Sniper Ammo' ? 15 : ammoType === 'Shotgun Shells' ? 16 : 45 })); }
      else if (roll < 76) loot.push(this.makeLoot('healing', x, z, { healType: roll < 65 ? 'bandage' : 'medkit', rarity: roll < 65 ? 'common' : 'rare' }));
      else if (roll < 86) loot.push(this.makeLoot('armor', x, z, { armorValue: 50, rarity: 'uncommon' }));
      else { const attachmentType = attachments[(i + p * 3) % attachments.length]; loot.push(this.makeLoot('attachment', x, z, { attachmentType, rarity: (attachmentType.includes('6x') || attachmentType.includes('8x') ? 'epic' : attachmentType.includes('4x') || attachmentType.includes('suppressor') ? 'rare' : 'uncommon') as Rarity })); }
    }
    // Also stock every roadside homestead compound with weapons, ammo, and medkits inside & outside the houses
    for (const [hIdx, spot] of this.buildingGenerator.homesteadSpots.entries()) {
      const weaponId = weapons[hIdx % weapons.length];
      const ammoType = WEAPONS[weaponId].ammoType;
      loot.push(
        this.makeLoot('weapon', spot.x + 1.5, spot.z + 1.2, { weaponId, rarity: WEAPONS[weaponId].rarity }),
        this.makeLoot('ammo', spot.x - 1.8, spot.z + 1.5, { ammoType, ammoAmount: 45 }),
        this.makeLoot('ammo', spot.x + 22, spot.z + (hIdx % 2 === 0 ? 11 : -11), { ammoType: 'Rifle Ammo', ammoAmount: 45 }),
        this.makeLoot('healing', spot.x + 2.2, spot.z - 2.0, { healType: hIdx % 2 === 0 ? 'medkit' : 'bandage', rarity: hIdx % 2 === 0 ? 'rare' : 'common' }),
        this.makeLoot('armor', spot.x + 24, spot.z + (hIdx % 2 === 0 ? 13 : -13), { armorValue: 50, rarity: 'uncommon' })
      );
    }
    return loot;
  }

  /** Spawns supply caches right around the player's landing zone so ammo & gear are always within reach. */
  private spawnLandingZoneSupplies(cx: number, cz: number): void {
    const weapons = Object.keys(WEAPONS) as WeaponId[];
    const newItems: LootItem[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.2;
      const r = 9 + (i % 2) * 5;
      const lx = cx + Math.cos(a) * r, lz = cz + Math.sin(a) * r;
      if (this.map.getTerrainHeight(lx, lz) < -1.0) continue;
      if (i === 0 || i === 3) {
        const wId = weapons[i % weapons.length];
        newItems.push(this.makeLoot('weapon', lx, lz, { weaponId: wId, rarity: WEAPONS[wId].rarity }));
      } else if (i === 1 || i === 4) {
        newItems.push(this.makeLoot('ammo', lx, lz, { ammoType: i === 1 ? 'Rifle Ammo' : 'SMG Ammo', ammoAmount: 60, rarity: 'uncommon' }));
      } else if (i === 2) {
        newItems.push(this.makeLoot('healing', lx, lz, { healType: 'medkit', rarity: 'rare' }));
      } else {
        newItems.push(this.makeLoot('armor', lx, lz, { armorValue: 50, rarity: 'uncommon' }));
      }
    }
    this.offlineLoot.push(...newItems);
    this.inventorySystem.updateWorldLoot(this.offlineLoot);
  }

  private startOfflineSinglePlayerMatch(): void {
    this.combatSystem.serverAuthoritative = false;
    const startingWeapon = this.currentProfile.weaponId || 'viper_ar';
    this.inventorySystem.primaryWeapon = startingWeapon;
    this.inventorySystem.secondaryWeapon = this.currentProfile.secondaryWeaponId || null;
    this.inventorySystem.activeSlot = 1;
    this.inventorySystem.magAmmo.primary = WEAPONS[startingWeapon].magazineSize;
    this.inventorySystem.magAmmo.secondary = this.inventorySystem.secondaryWeapon ? WEAPONS[this.inventorySystem.secondaryWeapon].magazineSize : 0;
    this.inventorySystem.attachments.primary.optic = this.currentProfile.opticId || 'optic_reddot';
    this.inventorySystem.healingItems = { medkit: 1, bandage: 3, shieldCell: 0 };
    this.combatSystem.setEquippedWeapon(startingWeapon, false);
    this.lobbyShowcaseStage.setWeapon(startingWeapon,this.currentProfile.opticId);
    this.gameHUD.setMode(this.isTrainingGround ? 'TRAINING' : 'SOLO / AI');
    this.gameHUD.setNetwork('LOCAL');
    this.gameHUD.setFireMode(this.combatSystem.fireMode);
    this.isOfflineSinglePlayer = true;
    this.isGameActive = true;
    if (!this.isTrainingGround) {
      this.battleWorldObjects.forEach(o => o.visible = true);
      if (this.vehicleManager.vehicles.size === 0) {
        this.vehicleManager.spawnOfflineVehicles();
      } else {
        this.vehicleManager.vehicles.forEach(v => { v.visible = true; });
      }
    }
    this.playerController.enabled = true;
    this.gameHUD.show();
    this.offlineHealth = 100;
    this.offlineArmor = 50;
    this.offlineMaxArmor = 50;
    this.offlineDamage = 0;
    this.offlineStartTime = this.gameNow();
    this.offlineLastZoneTick = this.gameNow();
    this.offlineCombatAt = this.isTrainingGround ? Infinity : this.gameNow() + 75000;
    this.offlineBotFireCooldowns.clear();
    this.offlineBotWaypoints.clear();
    this.offlineBotAware.clear();
    if (this.isTrainingGround) {
      this.playerController.position.set(0, 1.7, 0);
      this.playerController.isDropping = false;
      this.playerController.isGrounded = true;
    } else {
      // Ride the transport across the valley and choose where to jump.
      this.dropPlane.launch();
      this.playerController.planePosition.copy(this.dropPlane.group.position);
      this.playerController.planeVelocity.copy(this.dropPlane.velocity);
      this.playerController.boardPlane();
      this.playerController.yaw = Math.atan2(-this.dropPlane.direction.x, -this.dropPlane.direction.z);
      this.playerController.pitch = -.2;
    }
    this.lobbyShowcaseStage.setVisible(false);
    this.lobbyUI.hide();

    const botNames = ['Viper', 'Shadow', 'Falcon', 'Apex', 'Spectre', 'Rogue', 'Ironclad', 'Titan', 'Nexus', 'Phantom'];
    const botColors = ['#e04f4f', '#f0932b', '#22a6b3', '#6ab04c', '#be2edd', '#4834d4'];
    this.hotDropDeployed = false;

    this.offlineBots = (this.isTrainingGround ? [] : Array.from({ length: 49 }, (_, i) => `${botNames[i % botNames.length]}_${String(i + 1).padStart(2, '0')}`)).map((name, i) => {
      const poi = POI_LOCATIONS[i % POI_LOCATIONS.length];
      const angle = i * 2.399963;
      const radius = 35 + Math.sqrt(((i * 31) % 100) / 100) * poi.radius * 0.7;
      const weapon = BOT_WEAPONS[i % BOT_WEAPONS.length];
      return {
        id: `offline_bot_${i}`,
        name: `[BOT] ${name}`,
        squadId: `squad_bot_${i}`,
        position: { x: poi.x + Math.cos(angle) * radius, y: 0, z: poi.z + Math.sin(angle) * radius },
        rotation: { yaw: Math.random() * Math.PI * 2, pitch: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        health: 100, maxHealth: 100, armor: 50, maxArmor: 50,
        isDowned: false, downedTimer: 0, isEliminated: false, isHost: false, isReady: true, isDropping: false, altitude: 0,
        equippedWeapon: weapon,
        secondaryWeapon: null,
        activeSlot: 1,
        ammo: { [WEAPONS[weapon].ammoType]: 150 },
        magAmmo: { primary: WEAPONS[weapon].magazineSize, secondary: 0 },
        healingItems: { medkit: 1, bandage: 4, shieldCell: 2 },
        attachments: { primary: { optic: null, muzzle: null, grip: null, mag: null }, secondary: { optic: null, muzzle: null, grip: null, mag: null } },
        vehicleId: null, kills: 0, damageDealt: 0, revives: 0,
        color: botColors[i % botColors.length]
      } as PlayerState;
    });
    this.offlineBots.forEach(bot => { bot.position.y = Math.max(-2.35, this.map.getTerrainHeight(bot.position.x, bot.position.z)); });

    const p1 = ZONE_PHASES[0];
    this.offlineZone = {
      currentCenter: { x: 0, y: 0, z: 0 }, currentRadius: p1.radius, targetCenter: { x: 0, y: 0, z: 0 }, targetRadius: p1.radius * 0.6,
      phase: 1, phaseTimer: p1.durationSeconds, phaseDuration: p1.durationSeconds, isShrinking: false, dps: p1.dps
    };
    if (!this.isTrainingGround) this.stormVisuals.updateZone(this.offlineZone);
    if (this.isTrainingGround) {
      this.offlineLoot = [
        ...(Object.keys(WEAPONS) as WeaponId[]).map((weaponId, index) => ({
          id: `training_weapon_${weaponId}`, type: 'weapon' as const, rarity: WEAPONS[weaponId].rarity, weaponId,
          position: { x: -10 + index * 5, y: 0.88, z: 4.2 }
        })),
        ...(Object.keys(ATTACHMENT_INFO) as AttachmentType[]).map((attachmentType, index) => ({
          id: `training_att_${attachmentType}`, type: 'attachment' as const,
          rarity: (attachmentType.includes('6x') || attachmentType.includes('8x') ? 'epic' : attachmentType.includes('4x') || attachmentType.includes('suppressor') ? 'rare' : 'uncommon') as Rarity,
          attachmentType,
          position: { x: -9.5 + index * 1.9, y: 0.88, z: 7.8 }
        }))
      ];
      ['Rifle Ammo', 'SMG Ammo', 'Shotgun Shells', 'Sniper Ammo'].forEach((ammoType, idx) => {
        this.offlineLoot.push({ id: this.nextLootId('training_ammo'), type: 'ammo', rarity: 'common', ammoType, ammoAmount: 120, position: { x: -4.5 + idx * 3, y: 0, z: 10.5 } });
      });
      this.inventorySystem.updateWorldLoot(this.offlineLoot);
    } else if (this.offlineLoot.length === 0 || this.inventorySystem.lootMeshes.size === 0) {
      this.offlineLoot = [
        this.makeLoot('weapon', SOLO_SPAWN.x + 4, SOLO_SPAWN.z, { weaponId: 'rook_smg' }),
        this.makeLoot('armor', SOLO_SPAWN.x - 4, SOLO_SPAWN.z, { armorValue: 50, rarity: 'uncommon' }),
        this.makeLoot('healing', SOLO_SPAWN.x, SOLO_SPAWN.z + 5, { healType: 'medkit', rarity: 'rare' }),
        this.makeLoot('ammo', SOLO_SPAWN.x + 2, SOLO_SPAWN.z - 5, { ammoType: 'Rifle Ammo', ammoAmount: 60 }),
        ...this.generateOfflineLoot()
      ];
      this.inventorySystem.updateWorldLoot(this.offlineLoot);
    } else {
      this.inventorySystem.lootMeshes.forEach(m => { m.visible = true; });
    }
  }

  /** PUBG-style pickup: fill an empty slot, otherwise swap with the gun in hand. */
  private pickupOfflineLoot(lootId: string): void {
    const item = this.offlineLoot.find(l => l.id === lootId);
    if (!item) return;
    const inv = this.inventorySystem;
    let detail = 'Added to inventory';
    if (item.type === 'weapon' && item.weaponId) {
      const weapon = WEAPONS[item.weaponId];
      const slot: 1 | 2 = !inv.primaryWeapon ? 1 : !inv.secondaryWeapon ? 2 : inv.activeSlot;
      const keepSlot = inv.activeSlot;
      // The swapped-out gun drops at your feet; its attachments go to the backpack.
      const replaced = removeWeapon(inv, slot);
      inv.activeSlot = keepSlot;
      if (replaced) {
        const here = this.playerController.position;
        this.offlineLoot.push(this.makeLoot('weapon', here.x + Math.cos(this.playerController.yaw) * .9, here.z - Math.sin(this.playerController.yaw) * .9, { weaponId: replaced, rarity: WEAPONS[replaced].rarity }));
        detail = `Dropped ${WEAPONS[replaced].name} · its attachments are in your backpack`;
      }
      if (slot === 1) inv.primaryWeapon = item.weaponId; else inv.secondaryWeapon = item.weaponId;
      inv.magAmmo[slot === 1 ? 'primary' : 'secondary'] = weapon.magazineSize;
      inv.ammo[weapon.ammoType] = (inv.ammo[weapon.ammoType] || 0) + weapon.magazineSize;
      if (!inv.getActiveWeaponId()) inv.activeSlot = slot;
      if (inv.activeSlot === slot) {
        this.combatSystem.setEquippedWeapon(item.weaponId);
        this.lobbyShowcaseStage.setWeapon(item.weaponId, '');
      }
    } else if (item.type === 'ammo' && item.ammoType) {
      inv.ammo[item.ammoType] = (inv.ammo[item.ammoType] || 0) + (item.ammoAmount || 30);
      detail = `+${item.ammoAmount || 30} rounds`;
    } else if (item.type === 'healing' && item.healType) {
      inv.healingItems[item.healType]++;
      detail = item.healType === 'medkit' ? 'Press H to use · restores full health' : 'Press J to use · +25 HP up to 75';
    } else if (item.type === 'armor') {
      if (this.offlineArmor >= 100) { this.gameHUD.showLootToast('Armor full', 'Your vest is already at 100.'); return; }
      this.offlineMaxArmor = 100;
      this.offlineArmor = Math.min(100, this.offlineArmor + (item.armorValue || 50));
      detail = `Armor ${Math.round(this.offlineArmor)} / 100`;
    } else if (item.type === 'attachment' && item.attachmentType) {
      const fittedTo = fitPickedAttachment(inv, item.attachmentType);
      this.refreshHeldWeapon();
      detail = fittedTo === 'backpack' ? 'No compatible weapon · stored in backpack (Tab)' : `${ATTACHMENT_INFO[item.attachmentType].effect} · fitted to slot ${fittedTo === 'primary' ? 1 : 2}`;
    }
    this.gameHUD.showLootToast(lootLabel(item), detail);
    this.offlineLoot = this.offlineLoot.filter(l => l.id !== lootId);
    this.inventorySystem.updateWorldLoot(this.offlineLoot);
  }

  private damageOfflineBot(bot: PlayerState, damage: number, headshot: boolean, weaponName: string): void {
    const absorbed = Math.min(bot.armor, damage * .6);
    bot.armor -= absorbed;
    const dealt = Math.min(bot.health, damage - absorbed);
    bot.health = Math.max(0, bot.health - (damage - absorbed));
    this.offlineDamage += dealt + absorbed;
    this.offlineBotAware.set(bot.id, Math.min(this.offlineBotAware.get(bot.id) ?? Infinity, this.gameNow() + 250));
    if (bot.health > 0) return;
    this.eliminateOfflineBot(bot, this.currentProfile.name, weaponName, headshot);
  }

  private eliminateOfflineBot(bot: PlayerState, killer: string, weaponName: string, headshot: boolean): void {
    bot.isEliminated = true;
    this.offlineKillFeed.push({ id: 'kf_' + Date.now() + bot.id, killerName: killer, victimName: bot.name, weaponName, isHeadshot: headshot, timestamp: Date.now() });
    if (killer === this.currentProfile.name) this.recordDailyContractKill();
    // Death crate: their gun, ammo and a med.
    const { x, z } = bot.position;
    const weapon = bot.equippedWeapon || 'viper_ar';
    this.offlineLoot.push(
      this.makeLoot('weapon', x + .8, z, { weaponId: weapon, rarity: WEAPONS[weapon].rarity }),
      this.makeLoot('ammo', x - .6, z + .5, { ammoType: WEAPONS[weapon].ammoType, ammoAmount: WEAPONS[weapon].category === 'shotgun' ? 12 : 30 }),
      this.makeLoot('healing', x, z - .8, { healType: Math.random() < .25 ? 'medkit' : 'bandage', rarity: 'common' })
    );
    this.inventorySystem.updateWorldLoot(this.offlineLoot);
    if (this.offlineBots.every(b => b.isEliminated)) this.finishOfflineMatch(true);
  }

  private processOfflineWeaponFire(origin: THREE.Vector3, direction: THREE.Vector3, weaponId: WeaponId, pellets?: THREE.Vector3[]): void {
    const config = WEAPONS[weaponId];
    if (!config) return;
    const hits = new Map<PlayerState, { damage: number; headshot: boolean }>();
    for (const dir of pellets ?? [direction]) {
      const result = this.resolveShot(origin, dir, config.range);
      if (result.kind !== 'player') continue;
      const bot = this.offlineBots.find(b => !b.isEliminated && Math.abs(b.position.x - result.point.x) < 1.2 && Math.abs(b.position.z - result.point.z) < 1.2);
      if (!bot) continue;
      const falloff = result.distance > config.range * .6 ? .75 : 1;
      const damage = config.damage * falloff * (result.headshot ? config.headshotMultiplier : 1);
      const entry = hits.get(bot) ?? { damage: 0, headshot: false };
      entry.damage += damage; entry.headshot ||= !!result.headshot;
      hits.set(bot, entry);
    }
    for (const [bot, { damage, headshot }] of hits) {
      this.damageOfflineBot(bot, damage, headshot, config.name);
      this.gameHUD.showHitMarker(Math.round(damage), headshot, bot.isEliminated);
      this.soundManager.playHitMarker(headshot, bot.isEliminated);
    }
  }

  private applyMatchXp(earned: number): void {
    this.currentProfile.xp += earned;
    this.currentProfile.level = 1 + Math.floor(this.currentProfile.xp / 1000);
    localStorage.setItem('dropzone_profile', JSON.stringify(this.currentProfile));
    this.lobbyUI.setProfile(this.currentProfile);
  }

  private recordDailyContractKill(): void {
    const today = new Date().toISOString().slice(0, 10);
    let state = { date: today, kills: 0, complete: false };
    try {
      const saved = JSON.parse(localStorage.getItem('dropzone_daily_contract') || 'null');
      if (saved?.date === today) state = { ...state, kills: Math.max(0, saved.kills || 0), complete: !!saved.complete };
    } catch { /* Replace invalid local progress. */ }
    if (state.complete) return;
    state.kills = Math.min(3, state.kills + 1);
    state.complete = state.kills >= 3;
    localStorage.setItem('dropzone_daily_contract', JSON.stringify(state));
    if (state.complete) this.applyMatchXp(250);
    else this.lobbyUI.setProfile(this.currentProfile);
  }

  private finishOfflineMatch(victory: boolean): void {
    if (!this.isGameActive) return;
    this.isGameActive = false;
    this.playerController.enabled = false;
    this.heal = null;
    this.soundManager.setWind(0); this.soundManager.setEngine(0);
    if (document.pointerLockElement) document.exitPointerLock();
    if (victory) this.soundManager.playVictoryFanfare(); else this.soundManager.playDefeat();
    const kills = this.isTrainingGround ? this.trainingHits : this.offlineKillFeed.filter(k => k.killerName === this.currentProfile.name).length;
    const survivalTimeSeconds = Math.floor((this.gameNow() - this.offlineStartTime) / 1000);
    const placement = victory ? 1 : this.offlineBots.filter(b => !b.isEliminated).length + 1;
    const xpEarned = this.isTrainingGround ? 0 : 15 + kills * 150 + Math.floor(this.offlineDamage / 100) * 50 + Math.floor(survivalTimeSeconds / 60) * 30 + (victory ? 500 : placement <= 3 ? 250 : 0);
    this.applyMatchXp(xpEarned);
    const stats = [{ playerId: this.localPlayerId, playerName: this.currentProfile.name, placement, kills, damage: Math.round(this.offlineDamage), revives: 0, survivalTimeSeconds, xpEarned }];
    window.setTimeout(() => this.resultsUI.show(victory ? this.currentProfile.name : this.offlineLastAttacker || 'The storm', this.localPlayerId, stats), victory ? 200 : 1200);
  }

  private returnToLobby(): void {
    this.isGameActive = false;
    this.isOfflineSinglePlayer = false;
    this.isTrainingGround = false;
    this.playerController.enabled = false;
    this.playerController.isScoped = false;
    this.playerController.isDriving = false;
    this.playerController.drivingVehicleId = null;
    this.playerController.dropStage = 'none';
    this.playerController.isDropping = false;
    this.playerController.trainingMode = false;
    this.heal = null;
    this.soundManager.setWind(0);
    this.soundManager.setEngine(0);
    this.soundManager.setVehicleEngine(0, false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.inventoryUI.toggle(false);
    this.tacticalMapUI.hide();
    this.resultsUI.hide();
    this.gameHUD.hide();
    this.trainingGroundMap.setVisible(false);
    this.battleWorldObjects.forEach(o => { o.visible = false; });
    this.inventorySystem.updateWorldLoot([]);
    for (const m of this.remotePlayers.values()) m.visible = false;
    this.lobbyShowcaseStage.createCharacterMesh(this.currentProfile.color, this.currentProfile.skin, this.currentProfile.outfit);
    this.lobbyShowcaseStage.setWeapon(this.currentProfile.weaponId || 'viper_ar', this.currentProfile.opticId);
    this.lobbyShowcaseStage.setVisible(true);
    this.lobbyUI.show();
  }

  /** Match clock in ms that only advances while the game simulates (not wall time). */
  private gameClock = 0;
  private hotDropDeployed = false;
  private gameNow(): number { return this.gameClock; }

  private offlineBotsActive(): boolean { return this.gameNow() >= this.offlineCombatAt; }

  /**
   * Deploys 12 challenger bots into the player's drop sector (parachuting from altitude
   * and patrolling nearby buildings) so the 50-bot lobby feels alive right where the player drops.
   */
  private deployHotDropBots(centerX: number, centerZ: number): void {
    if (this.hotDropDeployed || this.isTrainingGround || !this.isOfflineSinglePlayer) return;
    this.hotDropDeployed = true;
    const candidates = this.offlineBots
      .filter(b => !b.isEliminated)
      .sort((a, b) => Math.hypot(b.position.x - centerX, b.position.z - centerZ) - Math.hypot(a.position.x - centerX, a.position.z - centerZ))
      .slice(0, 7);

    candidates.forEach((bot, idx) => {
      const angle = (idx / candidates.length) * Math.PI * 2 + 0.45;
      const dist = 105 + (idx % 4) * 38;
      const bx = THREE.MathUtils.clamp(centerX + Math.cos(angle) * dist, -1450, 1450);
      const bz = THREE.MathUtils.clamp(centerZ + Math.sin(angle) * dist, -1450, 1450);
      const groundY = Math.max(-2.35, this.map.getTerrainHeight(bx, bz));
      bot.position.x = bx;
      bot.position.z = bz;
      if (idx < 5 && this.playerController.dropStage !== 'none') {
        bot.isDropping = true;
        bot.position.y = groundY + 95 + (idx % 4) * 35;
        bot.altitude = bot.position.y;
      } else {
        bot.isDropping = false;
        bot.position.y = groundY;
      }
      this.offlineBotWaypoints.set(
        bot.id,
        new THREE.Vector3(
          centerX + Math.cos(angle + 0.6) * 52,
          0,
          centerZ + Math.sin(angle + 0.6) * 52
        )
      );
    });
  }

  private updateOfflineBots(delta: number): void {
    const now = this.gameNow();
    const combat = this.offlineBotsActive();
    const player = this.playerController.position;
    const playerTargetable = this.playerController.dropStage === 'none' && this.playerController.enabled;
    for (const bot of this.offlineBots) {
      if (bot.isEliminated) continue;

      const groundAtBot = this.map.getTerrainHeight(bot.position.x, bot.position.z);
      if (bot.isDropping) {
        const alt = bot.position.y - groundAtBot;
        const fallRate = alt > 140 ? 46 : 16.5;
        bot.position.y -= fallRate * delta;
        const driftX = (player.x - bot.position.x) * 0.08;
        const driftZ = (player.z - bot.position.z) * 0.08;
        bot.position.x += THREE.MathUtils.clamp(driftX, -9, 9) * delta;
        bot.position.z += THREE.MathUtils.clamp(driftZ, -9, 9) * delta;
        bot.rotation.yaw = Math.atan2(-driftX, -driftZ);
        bot.velocity = { x: driftX, y: -fallRate, z: driftZ };
        if (bot.position.y <= Math.max(-2.35, groundAtBot)) {
          bot.position.y = Math.max(-2.35, groundAtBot);
          bot.isDropping = false;
        }
        continue;
      }

      let targetBot: PlayerState | null = null;
      const target = new THREE.Vector3();
      let distance = Infinity;
      if (playerTargetable) { target.set(player.x, player.y - .35, player.z); distance = Math.hypot(player.x - bot.position.x, player.z - bot.position.z); }
      for (const other of this.offlineBots) {
        if (other === bot || other.isEliminated || other.isDropping) continue;
        const d = Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z);
        // Bots skirmish with nearby bots and with the player.
        if (d < Math.min(distance * .92, 145)) { distance = d; targetBot = other; target.set(other.position.x, other.position.y + 1.3, other.position.z); }
      }
      const config = WEAPONS[bot.equippedWeapon || 'viper_ar'];
      const engageRange = Math.min(config.range * .85, config.category === 'shotgun' ? 38 : config.category === 'smg' ? 105 : 175);
      const engaging = combat && distance < engageRange;
      let dx = target.x - bot.position.x, dz = target.z - bot.position.z;
      if (!engaging) {
        this.offlineBotAware.delete(bot.id);
        let waypoint = this.offlineBotWaypoints.get(bot.id);
        if (!waypoint || Math.hypot(waypoint.x - bot.position.x, waypoint.z - bot.position.z) < 4) {
          const distToPlayer = Math.hypot(player.x - bot.position.x, player.z - bot.position.z);
          if (playerTargetable && distToPlayer < 420) {
            // Bots within 420m tactically converge toward the player's sector so the world feels active
            const flankAngle = Math.atan2(bot.position.z - player.z, bot.position.x - player.x) + (Math.random() - 0.5) * 1.1;
            const ringRadius = 24 + Math.random() * 48;
            waypoint = new THREE.Vector3(player.x + Math.cos(flankAngle) * ringRadius, 0, player.z + Math.sin(flankAngle) * ringRadius);
          } else {
            waypoint = new THREE.Vector3(bot.position.x + (Math.random() - .5) * 110, 0, bot.position.z + (Math.random() - .5) * 110);
          }
          this.offlineBotWaypoints.set(bot.id, waypoint);
        }
        dx = waypoint.x - bot.position.x; dz = waypoint.z - bot.position.z;
      }
      const length = Math.hypot(dx, dz) || 1;
      const ideal = config.category === 'shotgun' ? 8 : config.category === 'smg' ? 22 : 42;
      const advance = engaging ? (distance > ideal * 1.35 ? 4.4 : distance < ideal * .5 ? -2.2 : 0.8) : 4.2;
      const strafe = engaging && distance < ideal * 1.7 ? Math.sin(now * .0016 + Number(bot.id.split('_').pop())) * 2.8 : 0;
      const oldX = bot.position.x, oldZ = bot.position.z;
      const nx = oldX + (dx / length * advance - dz / length * strafe) * delta, nz = oldZ + (dz / length * advance + dx / length * strafe) * delta;
      const probe = new THREE.Vector3(nx, this.map.getTerrainHeight(nx, nz) + 1, nz);
      if (!this.playerController.boxesNear(nx, nz).some(box => box.containsPoint(probe))) { bot.position.x = nx; bot.position.z = nz; }
      else this.offlineBotWaypoints.delete(bot.id);
      const nextGround = this.map.getTerrainHeight(bot.position.x, bot.position.z);
      // Bots float at water surface when swimming across rivers/lakes
      bot.position.y = Math.max(-2.35, nextGround);
      bot.rotation.yaw = Math.atan2(-dx, -dz);
      bot.rotation.pitch = engaging ? Math.atan2(target.y - (bot.position.y + 1.45), length) : 0;
      bot.velocity = { x: (bot.position.x - oldX) / delta, y: 0, z: (bot.position.z - oldZ) / delta };
      if (!engaging) continue;
      // Reaction time before a bot opens fire on a newly seen target.
      if (!this.offlineBotAware.has(bot.id)) this.offlineBotAware.set(bot.id, now + 520 + Math.random() * 680);
      if (now < this.offlineBotAware.get(bot.id)! || now < (this.offlineBotFireCooldowns.get(bot.id) || 0)) continue;
      const interval = 60000 / config.fireRate;
      const burst = config.category === 'ar' || config.category === 'smg';
      this.offlineBotFireCooldowns.set(bot.id, now + (burst ? interval * (Math.random() < .25 ? 5.2 : 1.3) : interval * 1.45 + Math.random() * 420));
      const muzzle = new THREE.Vector3(bot.position.x, bot.position.y + 1.45, bot.position.z);
      const shot = target.clone().sub(muzzle);
      // Fast AABB line-of-sight check using spatially indexed building boxes (avoids costly triangle raycast lag)
      const shotLen = shot.length();
      const shotDir = shot.clone().divideScalar(shotLen || 1);
      const sightRay = new THREE.Ray(muzzle, shotDir);
      const hitPt = new THREE.Vector3();
      let blockedByWall = false;
      for (const box of this.playerController.boxesNear((muzzle.x + target.x) * 0.5, (muzzle.z + target.z) * 0.5)) {
        if (sightRay.intersectBox(box, hitPt) && hitPt.distanceTo(muzzle) < shotLen - 0.3) {
          blockedByWall = true;
          break;
        }
      }
      if (blockedByWall) continue;
      let blocked = false;
      for (let i = 1; i < 12; i++) { const v = muzzle.clone().addScaledVector(shot, i / 12); if (this.map.getTerrainHeight(v.x, v.z) > v.y) { blocked = true; break; } }
      if (blocked) continue;
      const moving = Math.hypot(this.playerController.velocity.x, this.playerController.velocity.z) > 3 && !targetBot;
      const accuracy = Math.max(.12, (config.category === 'shotgun' ? .8 : .58) - distance / (config.range * 1.1)) * (moving ? .7 : 1) * (this.playerController.isCrouching && !targetBot ? .8 : 1);
      const hit = Math.random() < accuracy;
      const model = this.remotePlayers.get(bot.id);
      model?.fire();
      const from = model?.getMuzzle()?.position ?? muzzle;
      const end = hit ? target.clone() : target.clone().add(new THREE.Vector3((Math.random() - .5) * 3, Math.random() * 1.6, (Math.random() - .5) * 3));
      this.particleSystem.spawnTracer(from, end);
      this.particleSystem.spawnMuzzleFlash(from, shot.clone().normalize(), .8);
      this.soundManager.playSpatialGunshot(muzzle, player, config.category);
      if (Math.hypot(bot.position.x - player.x, bot.position.z - player.z) < 320) {
        this.gameHUD.gunfireBlips.push({ x: bot.position.x, z: bot.position.z, time: performance.now() });
      }
      if (!hit) { if (!targetBot) this.checkNearMiss(muzzle, end.clone().addScaledVector(shot.clone().normalize(), 20)); continue; }
      const damage = config.damage * (config.pellets ? 2.6 : 1) * (targetBot ? .78 : .34);
      if (targetBot) {
        const absorbed = Math.min(targetBot.armor, damage * .6); targetBot.armor -= absorbed; targetBot.health -= damage - absorbed;
        bot.damageDealt += damage;
        this.particleSystem.spawnBloodHit(end, shot.clone().normalize());
        if (targetBot.health <= 0) { targetBot.health = 0; bot.kills++; this.eliminateOfflineBot(targetBot, bot.name, config.name, false); }
      } else {
        const absorbed = Math.min(this.offlineArmor, damage * .6); this.offlineArmor -= absorbed; this.offlineHealth -= damage - absorbed;
        bot.damageDealt += damage;
        this.offlineLastAttacker = bot.name.replace('[BOT] ', '');
        this.gameHUD.showDamageIndicator(bot.name, Math.atan2(-dx, dz) - this.playerController.yaw);
        this.soundManager.playDamageTaken(damage > 20);
        this.playerController.addShake(damage > 20 ? 2 : 1);
        if (this.offlineHealth <= 0) { this.offlineHealth = 0; this.finishOfflineMatch(false); return; }
      }
    }
  }

  private updateOfflineZone(): void {
    const now = this.gameNow();
    const elapsed = (now - this.offlineStartTime) / 1000;
    this.offlineZone = zoneAtTime(elapsed);
    const zoneDelta = Math.min(.25, (now-this.offlineLastZoneTick)/1000);
    for(const bot of this.offlineBots){
      if(bot.isEliminated)continue;
      const distance=Math.hypot(bot.position.x,bot.position.z);
      if(distance>this.offlineZone.currentRadius*.8){bot.position.x-=bot.position.x/distance*zoneDelta*8;bot.position.z-=bot.position.z/distance*zoneDelta*8;bot.position.y=this.map.getTerrainHeight(bot.position.x,bot.position.z);}
      if(distance>this.offlineZone.currentRadius){bot.health-=this.offlineZone.dps*zoneDelta;if(bot.health<=0){bot.health=0;this.eliminateOfflineBot(bot,'The storm','Zone',false);}}
    }
    if (!this.isGameActive) return;
    this.stormVisuals.updateZone(this.offlineZone);
    const outside = this.playerController.dropStage === 'none' && Math.hypot(this.playerController.position.x, this.playerController.position.z) > this.offlineZone.currentRadius;
    const seconds = Math.min((now - this.offlineLastZoneTick) / 1000, .25);
    this.offlineLastZoneTick = now;
    if (outside) {
      this.offlineHealth = Math.max(0, this.offlineHealth - this.offlineZone.dps * seconds);
      this.gameHUD.showDamageIndicator('ZONE', 0);
      if (this.offlineHealth <= 0) { this.offlineLastAttacker = 'The storm'; this.finishOfflineMatch(false); }
    }
  }

  private sendPacket(packet: ClientPacket): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(packet));
  }

  private poseFor(p: PlayerState, offline: boolean): OperatorPose {
    if (p.isEliminated) return 'dead';
    if (p.isDowned) return 'downed';
    if (p.vehicleId) return 'driving';
    if (p.isDropping) {
      const altitude = (offline ? p.position.y : p.position.y - 1.7) - this.map.getTerrainHeight(p.position.x, p.position.z);
      return altitude > 140 ? 'freefall' : 'parachute';
    }
    if (this.map.getTerrainHeight(p.position.x, p.position.z) < -1.55) return 'swimming';
    return 'ground';
  }

  private updateRemotePlayers(players: PlayerState[]): void {
    const activeIds = new Set(players.map(p=>p.id));
    for (const [id, model] of this.remotePlayers) if (!activeIds.has(id)) { this.scene.remove(model); this.remotePlayers.delete(id); }
    const offline = this.isOfflineSinglePlayer;
    for (const pState of players) {
      if (pState.id === this.localPlayerId) continue;
      let model = this.remotePlayers.get(pState.id);
      if (!model) {
        model = new OperatorModel();
        model.setAppearance(pState.color || '#617a72', pState.skin, pState.outfit);
        model.setWeapon(pState.equippedWeapon || 'viper_ar');
        this.scene.add(model);
        this.remotePlayers.set(pState.id, model);
      }
      const weaponKey = pState.equippedWeapon + ':' + pState.activeSlot;
      if (model.userData.weaponKey !== weaponKey) { model.setWeapon(pState.equippedWeapon || 'viper_ar', pState.attachments[pState.activeSlot === 1 ? 'primary' : 'secondary'].optic || ''); model.userData.weaponKey = weaponKey; }
      const pose = this.poseFor(pState, offline);
      if (pose === 'dead' && model.pose !== 'dead') model.userData.deadAt = performance.now();
      model.setPose(pose);
      model.aimPitch = pState.rotation.pitch;
      // Bodies remain for a while so kills read clearly, then clear away. Operators beyond
      // fog range are not drawn; only nearby ones get arm IK and cast shadows.
      const distance = Math.hypot(pState.position.x - this.playerController.position.x, pState.position.z - this.playerController.position.z);
      model.visible = distance < 450 && pose !== 'driving' && !(pose === 'dead' && performance.now() - (model.userData.deadAt || 0) > 12000);
      model.detailed = distance < 70;
      model.setShadow(distance < 90 && !this.lowQuality);
      if (pose === 'dead') continue;
      const baseY = offline ? pState.position.y : pState.position.y - 1.7;
      const target = new THREE.Vector3(pState.position.x, baseY, pState.position.z);
      if (!model.userData.target) model.position.copy(target);
      model.userData.speed = Math.hypot(pState.velocity.x, pState.velocity.z);
      model.userData.target = target;
      model.userData.yaw = pState.rotation.yaw;
    }
  }

  private animateRemotePlayers(delta: number): void {
    const camera = this.playerController.position;
    for (const mesh of this.remotePlayers.values()) {
      if (!mesh.visible || !mesh.userData.target) continue;
      mesh.position.lerp(mesh.userData.target, 1 - Math.exp(-14 * delta));
      const yaw = mesh.userData.yaw ?? 0;
      mesh.rotation.y += (THREE.MathUtils.euclideanModulo(yaw - mesh.rotation.y + Math.PI, Math.PI * 2) - Math.PI) * (1 - Math.exp(-12 * delta));
      // Distant operators animate at a lower rate to save CPU.
      const far = mesh.position.distanceTo(camera) > 180;
      mesh.userData.skip = far ? ((mesh.userData.skip || 0) + 1) % 4 : 0;
      if (mesh.userData.skip === 0) mesh.update(far ? delta * 4 : delta, mesh.userData.speed || 0);
    }
  }

  private dropStatus(): string | null {
    const pc = this.playerController;
    if (pc.dropStage === 'plane') return `<strong>AIRBORNE</strong><span>PRESS F TO JUMP</span>`;
    if (pc.dropStage === 'freefall') return `<strong>${Math.round(pc.altitudeAboveGround)} M</strong><span>WASD STEER · SPACE PARACHUTE</span>`;
    if (pc.dropStage === 'parachute') return `<strong>${Math.round(pc.altitudeAboveGround)} M</strong><span>W DIVE · S BRAKE · A/D BANK</span>`;
    if (pc.isSwimming) return `<strong>SWIMMING</strong><span>SHIFT SPRINT · SPACE CLIMB OUT</span>`;
    return null;
  }

  private updateDrop(delta: number): void {
    const pc = this.playerController;
    if (this.dropPlane.group.visible) this.dropPlane.update(delta);
    if (pc.dropStage === 'plane') {
      pc.planePosition.copy(this.dropPlane.group.position);
      pc.planeVelocity.copy(this.dropPlane.velocity);
      this.soundManager.setEngine(1);
      if (this.dropPlane.progress >= .97) {
        pc.jumpFromPlane();
        this.deployHotDropBots(pc.position.x, pc.position.z);
      }
    } else this.soundManager.setEngine(this.dropPlane.group.visible ? Math.max(0, .5 - this.dropPlane.group.position.distanceTo(pc.position) / 600) : 0);
    this.gameHUD.setDropStatus(this.dropStatus());
  }

  private crosshairGap(): number {
    const weapon = this.combatSystem.currentWeapon;
    if (!weapon) return 8;
    const spread = this.combatSystem.spreadAngle();
    return Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (window.innerHeight / 2);
  }

  private frameTimes: number[] = [];
  private lowQuality = false;
  private qualityStep = 0;
  /** Set by the dev harness: fixed-step capture must not trigger quality downgrades. */
  public qualityLocked = false;
  private lodFrame = 0;
  private sunDir = SUN_DIRECTION.clone();
  private sunRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
  private sunUp = new THREE.Vector3().crossVectors(this.sunDir, this.sunRight).normalize();
  private shadowCenter = new THREE.Vector3();

  /**
   * Centre the sun's shadow box on the ground under the player and snap it to
   * whole shadow-map texels, so shadows neither swim while walking nor sweep
   * across the valley while skydiving.
   */
  private updateShadowCamera(x: number, groundY: number, z: number): void {
    const texel = (this.sunLight.shadow.camera.right - this.sunLight.shadow.camera.left) / this.sunLight.shadow.mapSize.width;
    const c = this.shadowCenter.set(x, groundY, z);
    const r = c.dot(this.sunRight), u = c.dot(this.sunUp);
    c.addScaledVector(this.sunRight, Math.round(r / texel) * texel - r).addScaledVector(this.sunUp, Math.round(u / texel) * texel - u);
    this.sunLight.target.position.copy(c);
    this.sunLight.position.copy(c).addScaledVector(this.sunDir, 400);
  }

  /**
   * Step quality down when frames are slow: first resolution, then shadows.
   * Measured over ~1.5 s of gameplay so one hitch doesn't trigger it.
   */
  private adaptQuality(frameMs: number): void {
    if (this.qualityLocked || this.qualityStep >= 2 || !this.isGameActive || this.playerController.dropStage === 'plane') return;
    if (document.hidden || frameMs > 95) return;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length < 150) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)];
    this.frameTimes = [];
    if (typical < 42) return;
    this.qualityStep++;
    if (this.qualityStep === 1) { this.postfx.setQuality('medium'); return; }
    if (this.qualityStep === 2 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.postfx.setSize(window.innerWidth, window.innerHeight);
    }
  }

  private vehicleHitCooldown = new Map<string, number>();

  /** Engine audio, plus damage to anyone the vehicle drives into. */
  private updateVehicle(delta: number): void {
    const pc = this.playerController;
    this.soundManager.setVehicleEngine(pc.vehicleSpeed, pc.isDriving);
    // Dust plume from the rear wheels at speed.
    if (pc.isDriving && Math.abs(pc.vehicleSpeed) > 7 && Math.random() < delta * 14) {
      const back = new THREE.Vector3(Math.sin(pc.yaw) * 1.6, -.9, Math.cos(pc.yaw) * 1.6);
      this.particleSystem.spawnDustBurst(pc.position.clone().add(back), 1, 1.1 + Math.abs(pc.vehicleSpeed) / 20);
    }
    if (!pc.isDriving || !this.isOfflineSinglePlayer) return;
    const speed = Math.abs(pc.vehicleSpeed);
    if (speed < 4) return;
    const now = performance.now();
    // Sweep from last frame's position so fast cars can't skip over someone.
    const fx = pc.position.x - pc.velocity.x * delta, fz = pc.position.z - pc.velocity.z * delta;
    for (const bot of this.offlineBots) {
      if (bot.isEliminated) continue;
      const dx = pc.position.x - fx, dz = pc.position.z - fz, len = dx * dx + dz * dz;
      const t = len > 0 ? THREE.MathUtils.clamp(((bot.position.x - fx) * dx + (bot.position.z - fz) * dz) / len, 0, 1) : 0;
      if (Math.hypot(bot.position.x - (fx + dx * t), bot.position.z - (fz + dz * t)) > 2.4) continue;
      if (now - (this.vehicleHitCooldown.get(bot.id) || 0) < 800) continue;
      this.vehicleHitCooldown.set(bot.id, now);
      const damage = Math.min(160, speed * 6);
      // Vehicles mostly bypass armor.
      const absorbed = Math.min(bot.armor, damage * .15);
      bot.armor -= absorbed;
      const dealt = Math.min(bot.health, damage - absorbed);
      bot.health = Math.max(0, bot.health - (damage - absorbed));
      this.offlineDamage += dealt + absorbed;
      // Knock the body clear of the bumper.
      const side = Math.sign((bot.position.x - pc.position.x) * Math.cos(pc.yaw) - (bot.position.z - pc.position.z) * Math.sin(pc.yaw)) || 1;
      bot.position.x += Math.cos(pc.yaw) * side * 2.5 - Math.sin(pc.yaw) * 1.5;
      bot.position.z += -Math.sin(pc.yaw) * side * 2.5 - Math.cos(pc.yaw) * 1.5;
      bot.position.y = this.map.getTerrainHeight(bot.position.x, bot.position.z);
      this.particleSystem.spawnBloodHit(new THREE.Vector3(bot.position.x, bot.position.y + 1, bot.position.z), new THREE.Vector3(-Math.sin(pc.yaw), .3, -Math.cos(pc.yaw)));
      this.soundManager.playVehicleHit();
      pc.vehicleImpact();
      const killed = bot.health <= 0;
      if (killed) this.eliminateOfflineBot(bot, this.currentProfile.name, 'Scout Runner', false);
      this.gameHUD.showHitMarker(Math.round(damage), false, killed);
      this.soundManager.playHitMarker(false, killed);
    }
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const frameMs = now - this.lastFrame;
    this.adaptQuality(frameMs);
    // Allow larger steps so slow machines play at real speed rather than slow motion.
    const delta = Math.min(.1, Math.max(.001, frameMs / 1000));
    this.lastFrame = now;
    if (this.isGameActive) this.gameClock += delta * 1000;
    this.tacticalMapUI.enabled = this.isGameActive;
    this.inventorySystem.animate(now / 1000, this.playerController.position);
    this.atmosphere.update(delta,this.playerController.position,this.isGameActive&&!this.isTrainingGround);
    const vLocs = [...this.vehicleManager.vehicles.values()].map(v => ({ x: v.position.x, z: v.position.z, type: v.userData.type as string | undefined }));
    this.gameHUD.vehicleLocations = vLocs;
    this.tacticalMapUI.vehicleLocations = vLocs;
    this.networkAccumulator += delta;
    this.hudAccumulator += delta;
    const pc = this.playerController;

    if (!this.isGameActive) {
      this.combatSystem.setThirdPersonView(true);
      this.lobbyShowcaseStage.updateLobby(delta);
      if (this.lobbyShowcaseStage.isVisible) {
        this.camera.fov = 42; this.camera.updateProjectionMatrix();
        this.lobbyShowcaseStage.characterGroup.position.set(-.45, 0, 0);
        this.camera.position.set(0, 1.25, 3.9);
        this.camera.rotation.set(0, 0, 0);
        this.camera.lookAt(new THREE.Vector3(0, .95, 0));
      }
    } else {
      // Sub-step movement on long frames so thin walls cannot be tunnelled through.
      // Move the transport first so the camera riding it uses this frame's position.
      this.updateDrop(delta);
      if (pc.enabled) { const steps = delta > .04 ? 3 : 1; for (let i = 0; i < steps; i++) pc.update(delta / steps); }
      this.updateHeal(delta);
      this.combatSystem.update(delta);
      this.gameHUD.setReload(this.combatSystem.reloadProgress);
      this.gameHUD.setCrosshairSpread(this.crosshairGap(), pc.isSprinting || !!this.heal || pc.isDropping || pc.isDriving || pc.isSwimming || (pc.isScoped && pc.firstPerson));
      this.animateRemotePlayers(delta);
      this.soundManager.updateListener(pc.position, pc.yaw);
      const first = pc.firstPerson;
      this.combatSystem.setThirdPersonView(!first);
      const pose: OperatorPose = pc.dropStage === 'freefall' ? 'freefall' : pc.dropStage === 'parachute' ? 'parachute' : pc.isSwimming ? 'swimming' : 'ground';
      const ground = pc.trainingMode ? 0 : this.map.getTerrainHeight(pc.position.x, pc.position.z);
      const op = this.lobbyShowcaseStage.operator;
      if (op) op.bank = pc.dropStage === 'none' ? 0 : pc.dropTurnRate;
      this.lobbyShowcaseStage.setGameplayView(!first, pc.position, pc.dropStage === 'freefall' || pc.dropStage === 'parachute' ? pc.dropHeading : pc.yaw, pc.isDriving || pc.dropStage === 'plane', delta, pc.isCrouching, pc.isGrounded, pose, pc.pitch, pose === 'ground' && pc.isGrounded ? ground : undefined);
      this.updateShadowCamera(pc.position.x, ground, pc.position.z);
      this.updateVehicle(delta);
      if (++this.lodFrame % 10 === 0) { this.map.updateLod(pc.position, !this.lowQuality); this.vehicleManager.cull(pc.position); }
      if (this.inventoryUI.isOpen && this.lodFrame % 12 === 0) this.updateInventoryView();
      // Raise the near plane at altitude so distant roads and runways don't z-fight.
      const near = pc.dropStage === 'plane' || pc.dropStage === 'freefall' ? 2 : pc.dropStage === 'parachute' ? .5 : .1;
      if (this.camera.near !== near) { this.camera.near = near; this.camera.updateProjectionMatrix(); }

      if (this.isOfflineSinglePlayer) {
        if (!this.isTrainingGround) {
          this.updateOfflineBots(delta);
          this.updateOfflineZone();
        }
        this.updateRemotePlayers(this.offlineBots);
        const localState = this.offlineLocalState();
        if (this.hudAccumulator >= .05) {
          this.hudAccumulator = 0;
          this.gameHUD.update(localState, this.offlineZone, [localState], this.offlineKillFeed, pc.isScoped && pc.firstPerson && this.combatSystem.isMagnifiedOptic, pc.cameraMode, [localState, ...this.offlineBots]);
        }
        if (this.isTrainingGround) this.gameHUD.setPracticeScore(this.trainingHits);
        if (pc.isDriving && pc.drivingVehicleId) this.vehicleManager.updateLocalVehicle(pc.drivingVehicleId, pc.position, pc.yaw, pc.steerInput);
        this.tacticalMapUI.drawMap(localState, [localState, ...this.offlineBots], this.offlineZone, []);
      } else if (this.localPlayerId && pc.enabled && this.networkAccumulator >= .05) {
        this.networkAccumulator = 0;
        if (pc.isDriving && pc.drivingVehicleId) {
          this.vehicleSyncFrame++;
          if (this.vehicleSyncFrame % 2 === 0) this.sendPacket({
            type: 'DRIVE_VEHICLE', vehicleId: pc.drivingVehicleId,
            position: { x: pc.position.x, y: pc.position.y, z: pc.position.z },
            rotation: { yaw: pc.yaw, pitch: 0, roll: 0 },
            velocity: { x: pc.velocity.x, y: 0, z: pc.velocity.z }
          });
        }
        this.sendPacket({
          type: 'PLAYER_INPUT',
          position: { x: pc.position.x, y: pc.position.y, z: pc.position.z },
          rotation: { yaw: pc.yaw, pitch: pc.pitch },
          velocity: { x: pc.velocity.x, y: pc.velocity.y, z: pc.velocity.z },
          isSprinting: pc.isSprinting,
          isCrouching: pc.isCrouching,
          isDropping: pc.isDropping
        });
      }
      this.updatePickupPrompt();
    }

    // Dev-only cinematic camera override used by the trailer recorder.
    if (import.meta.env.DEV) (window as unknown as { __cameraHook?: (c: THREE.PerspectiveCamera) => void }).__cameraHook?.(this.camera);
    this.map.update(now / 1000, this.camera.position);
    if (this.isTrainingGround) this.trainingGroundMap.update(delta, now / 1000);
    else this.grass.update(this.camera.position, this.playerController.position, this.map.getTerrainHeight(this.camera.position.x, this.camera.position.z));
    // The view model renders as its own pass inside PostFX so it never clips into walls.
    this.postfx.render(this.isGameActive && this.combatSystem.viewModelVisible, now / 1000, this.isGameActive);
  }

  private updatePickupPrompt(): void {
    const pc = this.playerController;
    if (pc.dropStage !== 'none') { this.gameHUD.setPickupPrompt(null); return; }
    const local = this.onlineRoster.find(p => p.id === this.localPlayerId);
    const downed = !this.isOfflineSinglePlayer && local && this.onlineRoster.find(p => p.id !== local.id && p.squadId === local.squadId && p.isDowned && Math.hypot(p.position.x - local.position.x, p.position.z - local.position.z) < 3);
    if (downed) { this.gameHUD.setPickupPrompt('REVIVE ' + downed.name, '#7fd26a'); return; }
    if (pc.isDriving) { this.gameHUD.setPickupPrompt('EXIT VEHICLE'); return; }
    const loot = this.inventorySystem.getNearestLoot(pc.position);
    if (loot) {
      const swap = loot.type === 'weapon' && this.inventorySystem.primaryWeapon && this.inventorySystem.secondaryWeapon ? ` (swap for ${WEAPONS[this.inventorySystem.getActiveWeaponId() || 'viper_ar'].name})` : '';
      this.gameHUD.setPickupPrompt(`PICK UP ${lootLabel(loot).toUpperCase()}${swap}`, '#' + (RARITY_COLORS[loot.rarity] ?? 0xc9cbbd).toString(16).padStart(6, '0'));
      return;
    }
    const vehicle = this.vehicleManager.getNearestVehicle(pc.position, 5.2);
    this.gameHUD.setPickupPrompt(vehicle ? vehicle.spec.prompt : null);
  }

  private offlineLocalState(): PlayerState {
    const pc = this.playerController, inv = this.inventorySystem;
    const cast = (slot: typeof inv.attachments.primary) => ({ optic: slot.optic as AttachmentType | null, muzzle: slot.muzzle as AttachmentType | null, grip: slot.grip as AttachmentType | null, mag: slot.mag as AttachmentType | null });
    return {
      id: this.localPlayerId, name: this.currentProfile.name, squadId: 'squad_1',
      position: { x: pc.position.x, y: pc.position.y, z: pc.position.z },
      rotation: { yaw: pc.yaw, pitch: pc.pitch },
      velocity: { x: pc.velocity.x, y: pc.velocity.y, z: pc.velocity.z },
      health: this.offlineHealth, maxHealth: 100, armor: this.offlineArmor, maxArmor: this.offlineMaxArmor,
      isDowned: false, downedTimer: 0, isEliminated: false, isHost: true, isReady: true,
      isDropping: pc.isDropping, altitude: pc.position.y,
      equippedWeapon: inv.getActiveWeaponId(),
      primaryWeapon: inv.primaryWeapon || undefined, secondaryWeapon: inv.secondaryWeapon, activeSlot: inv.activeSlot,
      ammo: inv.ammo, magAmmo: inv.magAmmo, healingItems: inv.healingItems,
      attachments: { primary: cast(inv.attachments.primary), secondary: cast(inv.attachments.secondary) },
      vehicleId: pc.drivingVehicleId,
      kills: this.offlineKillFeed.filter(k => k.killerName === this.currentProfile.name).length,
      damageDealt: this.offlineDamage, revives: 0, color: this.currentProfile.color
    };
  }

  private initResizeListener(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.combatSystem.resize(this.camera.aspect);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postfx.setSize(window.innerWidth, window.innerHeight);
    });
  }
}

const game = new DropzoneGame();
if (import.meta.env.DEV) {
  (window as unknown as { __dropzone: DropzoneGame }).__dropzone = game;
  void import('./dev/harness');
}