## Main game controller — coordinates map, network, simulation, and UI.
extends Node2D

# --- Child node references ---
@onready var camera: Camera2D = $MapCamera
@onready var geography_layer: Node2D = $MapRenderer/GeographyLayer
@onready var network_layer: Node2D = $MapRenderer/NetworkLayer
@onready var vehicle_layer: Node2D = $MapRenderer/VehicleLayer

# --- UI references ---
@onready var sim_time_label: Label = %SimTime if has_node("%SimTime") else $UILayer/HUD/TopBar/HBoxContainer/SimTime
@onready var passenger_label: Label = $UILayer/HUD/TopBar/HBoxContainer/PassengerCount
@onready var routes_value: Label = $UILayer/HUD/AnalyticsPanel/VBox/StatsGrid/RoutesValue
@onready var stops_value: Label = $UILayer/HUD/AnalyticsPanel/VBox/StatsGrid/StopsValue
@onready var ridership_value: Label = $UILayer/HUD/AnalyticsPanel/VBox/StatsGrid/RidershipValue
@onready var revenue_value: Label = $UILayer/HUD/AnalyticsPanel/VBox/StatsGrid/RevenueValue

# --- State ---
enum Tool { SELECT, PLACE_STOP, DRAW_ROUTE, DELETE }
enum TransportMode { HEAVY_RAIL, METRO, TRAM, BUS }

var current_tool: Tool = Tool.SELECT
var current_mode: TransportMode = TransportMode.HEAVY_RAIL
var sim_speed: float = 1.0
var sim_paused: bool = false
var sim_time_minutes: int = 420  # 07:00 = 420 minutes from midnight

# Data holders
var geography_data: Dictionary = {}
var network: Dictionary = {
	"stops": [],
	"routes": [],
	"next_stop_id": 1,
	"next_route_id": 1,
}

# Route drawing state
var _route_drawing: bool = false
var _route_stops: Array = []
var _route_color: Color = Color.RED

# Precomputed mode colors
const MODE_COLORS: Dictionary = {
	TransportMode.HEAVY_RAIL: Color("#e94560"),
	TransportMode.METRO: Color("#0f3460"),
	TransportMode.TRAM: Color("#16a085"),
	TransportMode.BUS: Color("#f39c12"),
}

const MODE_NAMES: Dictionary = {
	TransportMode.HEAVY_RAIL: "Heavy Rail",
	TransportMode.METRO: "Metro",
	TransportMode.TRAM: "Tram",
	TransportMode.BUS: "Bus",
}

# UK bounds in projected coordinates (British National Grid approx, scaled)
# Using WGS84 lon/lat mapped to screen: lon -8 to 2, lat 49.5 to 61
const UK_BOUNDS: Rect2 = Rect2(-800, -6100, 1000, 1150)


func _ready() -> void:
	_connect_ui_signals()
	_load_geography()
	_update_analytics()
	print("High Speed Too — ready.")


func _process(delta: float) -> void:
	if not sim_paused:
		_advance_simulation(delta)
	_update_hud()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		var world_pos: Vector2 = get_global_mouse_position()

		match current_tool:
			Tool.PLACE_STOP:
				_place_stop(world_pos)
			Tool.DRAW_ROUTE:
				if event.button_index == MOUSE_BUTTON_LEFT:
					_add_route_waypoint(world_pos)
				elif event.button_index == MOUSE_BUTTON_RIGHT:
					_finish_route()
			Tool.DELETE:
				_delete_at(world_pos)
			Tool.SELECT:
				_select_at(world_pos)


# ──────────────────────────────────────────────
# Geography loading
# ──────────────────────────────────────────────

func _load_geography() -> void:
	var path := "res://data/geography/uk_regions.json"
	if not FileAccess.file_exists(path):
		print("No geography data found at %s — run the data pipeline first." % path)
		_draw_placeholder_uk()
		return

	var file := FileAccess.open(path, FileAccess.READ)
	var json := JSON.new()
	var err := json.parse(file.get_as_text())
	file.close()

	if err != OK:
		push_error("Failed to parse geography JSON: %s" % json.get_error_message())
		return

	geography_data = json.data
	_render_geography()


func _draw_placeholder_uk() -> void:
	# Draw a simplified UK outline so the game is usable without data pipeline
	var uk_outline := PackedVector2Array([
		# Very simplified Great Britain outline in lon/lat * 100
		Vector2(-500, -5000),  # SW Cornwall
		Vector2(-550, -5150),  # Wales
		Vector2(-300, -5350),  # NW England
		Vector2(-350, -5500),  # SW Scotland
		Vector2(-500, -5700),  # NW Scotland
		Vector2(-180, -5870),  # N Scotland
		Vector2(-100, -5750),  # NE Scotland
		Vector2(-150, -5500),  # E Scotland
		Vector2(-130, -5470),  # Borders
		Vector2(-160, -5350),  # NE England
		Vector2(-100, -5300),  # E England / Humber
		Vector2(  10, -5250),  # E Anglia
		Vector2( 150, -5170),  # SE England
		Vector2(  10, -5100),  # Kent
		Vector2(-100, -5080),  # S coast
		Vector2(-180, -5050),  # Dorset
		Vector2(-500, -5000),  # back to Cornwall
	])

	var polygon := Polygon2D.new()
	polygon.polygon = uk_outline
	polygon.color = Color(0.15, 0.18, 0.25, 1.0)
	geography_layer.add_child(polygon)

	# Draw outline
	var outline := Line2D.new()
	outline.points = uk_outline
	outline.width = 3.0
	outline.default_color = Color(0.3, 0.35, 0.45, 1.0)
	outline.closed = true
	geography_layer.add_child(outline)

	# Major city markers
	var cities := {
		"London": Vector2(  -12, -5150),
		"Birmingham": Vector2(-190, -5240),
		"Manchester": Vector2(-230, -5340),
		"Leeds": Vector2(-155, -5380),
		"Glasgow": Vector2(-420, -5580),
		"Edinburgh": Vector2(-320, -5590),
		"Cardiff": Vector2(-320, -5150),
		"Liverpool": Vector2(-300, -5330),
		"Bristol": Vector2(-260, -5140),
		"Newcastle": Vector2(-160, -5490),
		"Sheffield": Vector2(-150, -5330),
		"Nottingham": Vector2(-110, -5290),
		"Belfast": Vector2(-590, -5450),
	}

	for city_name: String in cities:
		var pos: Vector2 = cities[city_name]
		_draw_city_marker(pos, city_name)

	# Center camera on UK
	camera.position = Vector2(-200, -5350)
	camera.zoom = Vector2(0.15, 0.15)


func _draw_city_marker(pos: Vector2, city_name: String) -> void:
	var marker := Node2D.new()
	marker.position = pos

	var dot := Polygon2D.new()
	# Small circle approximation
	var circle_points := PackedVector2Array()
	for i in range(12):
		var angle := TAU * i / 12.0
		circle_points.append(Vector2(cos(angle), sin(angle)) * 8.0)
	dot.polygon = circle_points
	dot.color = Color(0.9, 0.9, 0.95, 0.8)
	marker.add_child(dot)

	var label := Label.new()
	label.text = city_name
	label.position = Vector2(12, -10)
	label.add_theme_font_size_override("font_size", 60)
	label.add_theme_color_override("font_color", Color(0.8, 0.82, 0.88, 0.9))
	marker.add_child(label)

	geography_layer.add_child(marker)


func _render_geography() -> void:
	# Render loaded GeoJSON regions — implemented when data pipeline provides real data
	pass


# ──────────────────────────────────────────────
# Network building
# ──────────────────────────────────────────────

func _place_stop(world_pos: Vector2) -> void:
	var stop := {
		"id": network.next_stop_id,
		"name": "Stop %d" % network.next_stop_id,
		"position": world_pos,
		"mode": current_mode,
		"routes": [],
	}
	network.next_stop_id += 1
	network.stops.append(stop)
	_draw_stop(stop)
	_update_analytics()
	print("Placed %s stop: %s at %s" % [MODE_NAMES[current_mode], stop.name, world_pos])


func _draw_stop(stop: Dictionary) -> void:
	var marker := Node2D.new()
	marker.position = stop.position
	marker.name = "Stop_%d" % stop.id

	var mode: TransportMode = stop.mode
	var color: Color = MODE_COLORS[mode]

	# Draw stop icon based on mode
	var shape: Polygon2D = Polygon2D.new()
	match mode:
		TransportMode.HEAVY_RAIL:
			# Circle
			var pts := PackedVector2Array()
			for i in range(16):
				var angle := TAU * i / 16.0
				pts.append(Vector2(cos(angle), sin(angle)) * 12.0)
			shape.polygon = pts
		TransportMode.METRO:
			# Diamond
			shape.polygon = PackedVector2Array([
				Vector2(0, -14), Vector2(14, 0), Vector2(0, 14), Vector2(-14, 0)
			])
		TransportMode.TRAM:
			# Rounded square (simple square for now)
			shape.polygon = PackedVector2Array([
				Vector2(-10, -10), Vector2(10, -10), Vector2(10, 10), Vector2(-10, 10)
			])
		TransportMode.BUS:
			# Small circle
			var pts := PackedVector2Array()
			for i in range(12):
				var angle := TAU * i / 12.0
				pts.append(Vector2(cos(angle), sin(angle)) * 8.0)
			shape.polygon = pts

	shape.color = color
	marker.add_child(shape)

	# White outline
	var outline := Line2D.new()
	outline.points = shape.polygon
	outline.closed = true
	outline.width = 2.0
	outline.default_color = Color.WHITE
	marker.add_child(outline)

	# Name label
	var label := Label.new()
	label.text = stop.name
	label.position = Vector2(16, -8)
	label.add_theme_font_size_override("font_size", 36)
	label.add_theme_color_override("font_color", Color.WHITE)
	marker.add_child(label)

	network_layer.add_child(marker)


func _add_route_waypoint(world_pos: Vector2) -> void:
	# Find nearest stop or place a new one
	var nearest_stop := _find_nearest_stop(world_pos, 30.0)
	if nearest_stop.is_empty():
		# Place a new stop at click position
		_place_stop(world_pos)
		nearest_stop = network.stops.back()

	if nearest_stop not in _route_stops:
		_route_stops.append(nearest_stop)
		_route_drawing = true

	# Redraw route preview
	_redraw_route_preview()


func _finish_route() -> void:
	if _route_stops.size() < 2:
		_route_stops.clear()
		_route_drawing = false
		_clear_route_preview()
		return

	var route := {
		"id": network.next_route_id,
		"name": "%s Line %d" % [MODE_NAMES[current_mode], network.next_route_id],
		"mode": current_mode,
		"color": MODE_COLORS[current_mode],
		"stops": _route_stops.duplicate(),
		"frequency_per_hour": 6,  # default: every 10 mins
	}
	network.next_route_id += 1
	network.routes.append(route)

	# Link stops to route
	for stop: Dictionary in _route_stops:
		stop.routes.append(route.id)

	_draw_route(route)
	_clear_route_preview()
	_route_stops.clear()
	_route_drawing = false
	_update_analytics()
	print("Created route: %s with %d stops" % [route.name, route.stops.size()])


func _draw_route(route: Dictionary) -> void:
	var line := Line2D.new()
	line.name = "Route_%d" % route.id
	line.width = 6.0
	line.default_color = route.color
	line.begin_cap_mode = Line2D.LINE_CAP_ROUND
	line.end_cap_mode = Line2D.LINE_CAP_ROUND
	line.antialiased = true

	for stop: Dictionary in route.stops:
		line.add_point(stop.position)

	network_layer.add_child(line)
	# Ensure line is behind stop markers
	network_layer.move_child(line, 0)


func _redraw_route_preview() -> void:
	_clear_route_preview()
	if _route_stops.size() < 1:
		return

	var preview := Line2D.new()
	preview.name = "_route_preview"
	preview.width = 4.0
	preview.default_color = Color(MODE_COLORS[current_mode], 0.5)
	preview.begin_cap_mode = Line2D.LINE_CAP_ROUND
	preview.end_cap_mode = Line2D.LINE_CAP_ROUND

	for stop: Dictionary in _route_stops:
		preview.add_point(stop.position)

	network_layer.add_child(preview)


func _clear_route_preview() -> void:
	var existing := network_layer.get_node_or_null("_route_preview")
	if existing:
		existing.queue_free()


func _find_nearest_stop(pos: Vector2, max_dist: float) -> Dictionary:
	var best: Dictionary = {}
	var best_dist: float = max_dist
	for stop: Dictionary in network.stops:
		var d: float = pos.distance_to(stop.position)
		if d < best_dist:
			best_dist = d
			best = stop
	return best


func _delete_at(world_pos: Vector2) -> void:
	var stop := _find_nearest_stop(world_pos, 30.0)
	if stop.is_empty():
		return
	# Remove from network
	network.stops.erase(stop)
	# Remove visual
	var node := network_layer.get_node_or_null("Stop_%d" % stop.id)
	if node:
		node.queue_free()
	_update_analytics()


func _select_at(_world_pos: Vector2) -> void:
	# Selection inspection — will show commuter info in Phase 5
	pass


# ──────────────────────────────────────────────
# Simulation
# ──────────────────────────────────────────────

func _advance_simulation(delta: float) -> void:
	sim_time_minutes += int(delta * sim_speed * 10)  # 10 game-minutes per real second at 1x
	if sim_time_minutes >= 1440:
		sim_time_minutes -= 1440  # wrap at midnight


# ──────────────────────────────────────────────
#  UI
# ──────────────────────────────────────────────

func _update_hud() -> void:
	var hours := sim_time_minutes / 60
	var mins := sim_time_minutes % 60
	sim_time_label.text = "%02d:%02d" % [hours, mins]


func _update_analytics() -> void:
	routes_value.text = str(network.routes.size())
	stops_value.text = str(network.stops.size())
	ridership_value.text = "0"  # Populated by simulation engine
	revenue_value.text = "£0"


func _connect_ui_signals() -> void:
	# Tool buttons
	var toolbar_vbox: VBoxContainer = $UILayer/HUD/Toolbar/ToolPanel/VBox
	toolbar_vbox.get_node("SelectBtn").pressed.connect(_on_tool_select)
	toolbar_vbox.get_node("StopBtn").pressed.connect(_on_tool_stop)
	toolbar_vbox.get_node("RouteBtn").pressed.connect(_on_tool_route)
	toolbar_vbox.get_node("DeleteBtn").pressed.connect(_on_tool_delete)

	# Mode buttons
	toolbar_vbox.get_node("HeavyRailBtn").pressed.connect(_on_mode_heavy_rail)
	toolbar_vbox.get_node("MetroBtn").pressed.connect(_on_mode_metro)
	toolbar_vbox.get_node("TramBtn").pressed.connect(_on_mode_tram)
	toolbar_vbox.get_node("BusBtn").pressed.connect(_on_mode_bus)

	# Speed controls
	var speed_box: HBoxContainer = $UILayer/HUD/TopBar/HBoxContainer/SpeedControls
	speed_box.get_node("PauseBtn").pressed.connect(func(): sim_paused = !sim_paused)
	speed_box.get_node("Speed1Btn").pressed.connect(func(): sim_speed = 1.0; sim_paused = false)
	speed_box.get_node("Speed2Btn").pressed.connect(func(): sim_speed = 2.0; sim_paused = false)
	speed_box.get_node("Speed4Btn").pressed.connect(func(): sim_speed = 4.0; sim_paused = false)


func _on_tool_select() -> void: current_tool = Tool.SELECT
func _on_tool_stop() -> void: current_tool = Tool.PLACE_STOP
func _on_tool_route() -> void: current_tool = Tool.DRAW_ROUTE
func _on_tool_delete() -> void: current_tool = Tool.DELETE

func _on_mode_heavy_rail() -> void: current_mode = TransportMode.HEAVY_RAIL
func _on_mode_metro() -> void: current_mode = TransportMode.METRO
func _on_mode_tram() -> void: current_mode = TransportMode.TRAM
func _on_mode_bus() -> void: current_mode = TransportMode.BUS
