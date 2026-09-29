@tool
extends Node
class_name AdManager

## ==========================================================
## STAGE 3: AdManager.gd Framework
## Manages lifetime consistent character marketing ads inside Godot.
## Completely offline logic leveraging local file routes.
## ==========================================================

const RULES_PATH: String = "res://branding/character_rules.txt"
const ADS_EXPORT_DIR: String = "res://assets/branding/ads/"

var active_branding_characters: Array = ["WINO", "TINO", "RINO"]
var manifest_loaded: bool = false

func _ready() -> void:
	print("[AdManager] Initializing backend marketing router...")
	_verify_branding_structure()

func _verify_branding_structure() -> void:
	# Check configuration matrix presence
	if not ResourceLoader.exists(RULES_PATH):
		push_warning("[AdManager] Warning: character_rules.txt matrix missing from directory.")
		return
		
	# Verify output directories for ad assets
	if not DirAccess.dir_exists_absolute(ADS_EXPORT_DIR):
		DirAccess.make_dir_recursive_absolute(ADS_EXPORT_DIR)
		print("[AdManager] Created empty local assets repository for advertisements.")
		
	manifest_loaded = true
	print("[AdManager] Setup successfully verified. Lifelong structure ready.")

func register_dynamic_ad_trigger(character_name: String, banner_node: TextureRect) -> void:
	if not manifest_loaded:
		push_error("[AdManager] Cannot trigger loading. System manifest unverified.")
		return
		
	var target_char = character_name.to_upper()
	if not active_branding_characters.has(target_char):
		push_error("[AdManager] Unknown character reference passed: " + character_name)
		return
		
	# Target filepath locator logic
	var ad_file_path = ADS_EXPORT_DIR.path_join("ad_canvas_layout_%s.png" % target_char.to_lower())
	
	if ResourceLoader.exists(ad_file_path):
		var texture = load(ad_file_path)
		if texture and banner_node:
			banner_node.texture = texture
			print("[AdManager] Dynamically loaded generated advertisement layout for: ", target_char)
	else:
		push_warning("[AdManager] Target ad texture missing at: %s. Please use Export Atlas from Showcase panel." % ad_file_path)
