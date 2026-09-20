export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["app-icon.png","boons/aegis.png","boons/alacheal.png","boons/alacrity.png","boons/celealacheal.png","boons/celequickheal.jpg","boons/claim.png","boons/dispel.png","boons/dps.png","boons/feedback.png","boons/flakkite.png","boons/fury.png","boons/immobile.png","boons/light.png","boons/mesmerportal.png","boons/might.png","boons/mushroom.png","boons/protect.png","boons/protection.png","boons/pull.png","boons/push.png","boons/quickheal.png","boons/quickness.png","boons/regeneration.png","boons/resistance.png","boons/resolution.png","boons/stability.png","boons/swiftness.png","boons/tank.png","boons/thiefportal.png","boons/tower.png","boons/vigor.png","bosses/aetherbladehideout.png","bosses/bandittrio.png","bosses/boneskinner.png","bosses/brokenking.png","bosses/cairntheindomitable.png","bosses/cardinaladina.png","bosses/cardinalsabir.png","bosses/conjuredamalgamate.png","bosses/cosmicobservatory.png","bosses/decima.png","bosses/deimos.png","bosses/dhuum.png","bosses/dragonvoid.png","bosses/eaterofsouls.png","bosses/eyeoffate.png","bosses/eyes.png","bosses/eyesoffate.png","bosses/fraenirofjormag.png","bosses/giants.png","bosses/gorseval.png","bosses/gorsevalthemultifarious.png","bosses/greer.png","bosses/harvesttemple.png","bosses/icebroodconstruct.png","bosses/kainengoverlook.png","bosses/keepconstruct.png","bosses/kela.png","bosses/largostwins.png","bosses/maitrin.png","bosses/matthiasgabrel.png","bosses/mcleodthesilent.png","bosses/mindblade.png","bosses/ministerli.png","bosses/mursaatoverseer.png","bosses/nexusofeternity.png","bosses/oldlionscourt.png","bosses/prototypevermilion.png","bosses/purification.png","bosses/qadim.png","bosses/qadimthepeerless.png","bosses/ritualist.png","bosses/riverofsouls.png","bosses/sabethathesaboteur.png","bosses/samarog.png","bosses/slothasor.png","bosses/sniper.png","bosses/souleater.png","bosses/soullesshorror.png","bosses/spiritrace.png","bosses/standardkittygolem.png","bosses/templeoffebe.png","bosses/theenforcerer.png","bosses/thejormagvoid.png","bosses/thekralkatorrikvoid.png","bosses/themechrider.png","bosses/themordremothvoid.png","bosses/theprimordusvoid.png","bosses/thesoowonvoid.png","bosses/thezhaitanvoid.png","bosses/timecaster.png","bosses/twinlargos.png","bosses/twistedcastle.png","bosses/unknown.png","bosses/ura.png","bosses/valeguardian.png","bosses/variniastormsounder.png","bosses/voiceandclaw.png","bosses/voidgoliath.png","bosses/voidobliterator.png","bosses/voidsaltspraydragon.png","bosses/whisperingshadow.png","bosses/whisperofjormag.png","bosses/xera.png","bosses/xunlaijadejunkyard.png","convergences/decima.png","convergences/demonknight.png","convergences/dreadwing.png","convergences/greer.png","convergences/hellsister.png","convergences/sorrow.png","convergences/umbriel.png","convergences/ura.png","dpsreport_icon.png","favicon.png","fractals/aetherbladelet.png","fractals/ai.png","fractals/amala.png","fractals/archdiviner.png","fractals/arkk.png","fractals/artsariiv.png","fractals/bloomhunger.png","fractals/captaincrowe.png","fractals/captainmaitrin.png","fractals/chaosanomaly.png","fractals/crowe.png","fractals/deepstonevoice.png","fractals/dredgepowersuit.png","fractals/dulfy.png","fractals/elementalsource.png","fractals/ensolyssoftheendlesstorment.png","fractals/eparch.png","fractals/frizz.png","fractals/giganicus.png","fractals/highpriestessamala.png","fractals/horrik.png","fractals/imbuedshaman.png","fractals/jademaw.png","fractals/jellyfish.png","fractals/jellyfishbeast.png","fractals/kanaxai.png","fractals/maitrin.png","fractals/mama.png","fractals/moltenberserker.png","fractals/moltenboss.png","fractals/moltenfirestorm.png","fractals/moltenfirestormberserker.png","fractals/mossman.png","fractals/rabidiceelemental.png","fractals/rampagingiceelemental.png","fractals/ravingasura.png","fractals/shamanlornarr.png","fractals/siaxthecorrupted.png","fractals/siegemasterdulfy.png","fractals/skorvaldtheshattered.png","fractals/solitarythrone.png","fractals/thaumanovaanomaly.png","fractals/thaumanovaboss.png","fractals/thevoice.png","fractals/whisperingshadow.png","mechanics/cerus_avatar.png","mechanics/empowered.png","mechanics/enraged.png","mechanics/insatiable_fanart.png","patch_notes/uploadviewer.png","professions/amalgam.png","professions/antiquary.png","professions/berserker.png","professions/bladesworn.png","professions/catalyst.png","professions/chronomancer.png","professions/conduit.png","professions/daredevil.png","professions/deadeye.png","professions/dragonhunter.png","professions/druid.png","professions/elementalist.png","professions/engineer.png","professions/evoker.png","professions/firebrand.png","professions/galeshot.png","professions/guardian.png","professions/harbinger.png","professions/herald.png","professions/holosmith.png","professions/luminary.png","professions/mechanist.png","professions/mesmer.png","professions/mirage.png","professions/necromancer.png","professions/paragon.png","professions/ranger.png","professions/reaper.png","professions/renegade.png","professions/revenant.png","professions/ritualist.png","professions/scourge.png","professions/scrapper.png","professions/soulbeast.png","professions/specter.png","professions/spellbreaker.png","professions/tempest.png","professions/thief.png","professions/troubadour.png","professions/untamed.png","professions/vindicator.png","professions/virtuoso.png","professions/warrior.png","professions/weaver.png","professions/willbender.png","squadcomp/bastionofthepenitent.png","squadcomp/hallofchains.png","squadcomp/keyofahdashim.png","squadcomp/mountbalrior.png","squadcomp/mythwrightgambit.png","squadcomp/salvationpass.png","squadcomp/spiritvale.png","squadcomp/strongholdofthefaithful.png","squadcomp/valeguardian.png","story_icons/asparklingrescue.png","story_icons/herethereeverywhere.png","story_icons/standbyyourkrewe.png","story_icons/takingcreditback.png","story_icons/thesnaffprize.png","svelte.svg","tauri.svg","vite.svg","wingman_icon.png","wvw/eternal_battlegrounds.jpg"]),
	mimeTypes: {".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.B5KfvoPk.js",app:"_app/immutable/entry/app.Dx2BG8uM.js",imports:["_app/immutable/entry/start.B5KfvoPk.js","_app/immutable/chunks/DPHN6NjP.js","_app/immutable/chunks/DNSL-cIm.js","_app/immutable/chunks/Brvr2FMH.js","_app/immutable/entry/app.Dx2BG8uM.js","_app/immutable/chunks/DJzjfcNK.js","_app/immutable/chunks/DNSL-cIm.js","_app/immutable/chunks/fmho7hBl.js","_app/immutable/chunks/C-Kivgc0.js","_app/immutable/chunks/vKSPaiWs.js","_app/immutable/chunks/Brvr2FMH.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
