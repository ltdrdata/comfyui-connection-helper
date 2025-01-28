import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function distance(node1, node2) {
	let dx = (node1.pos[0] + node1.size[0]/2) - (node2.pos[0] + node2.size[0]/2);
	let dy = (node1.pos[1] + node1.size[1]/2) - (node2.pos[1] + node2.size[1]/2);
	return Math.sqrt(dx * dx + dy * dy);
}

function lookup_nearest_nodes(node) {
	let nearest_distance = Infinity;
	let nearest_node = null;
	for(let other of app.graph._nodes) {
		if(other === node)
			continue;

		let dist = distance(node, other);
		if (dist < nearest_distance && dist < 1000) {
			nearest_distance = dist;
			nearest_node = other;
		}
	}

	return nearest_node;
}

function lookup_nearest_inputs(node) {
	let input_map = {};

	for(let i in node.inputs) {
		let input = node.inputs[i];

		if(input.link || input_map[input.type])
			continue;

		input_map[input.type] = {distance: Infinity, input_name: input.name, node: null, slot: null};
	}

	let x = node.pos[0];
	let y = node.pos[1] + node.size[1]/2;

	for(let other of app.graph._nodes) {
		if(other === node || !other.outputs)
			continue;

		let dx = x - (other.pos[0] + other.size[0]);
		let dy = y - (other.pos[1] + other.size[1]/2);

		if(dx < 0)
			continue;

		let dist = Math.sqrt(dx * dx + dy * dy);

		for(let input_type in input_map) {
			for(let j in other.outputs) {
				let output = other.outputs[j];
				if(output.type == input_type) {
					if(input_map[input_type].distance > dist) {
						input_map[input_type].distance = dist;
						input_map[input_type].node = other;
						input_map[input_type].slot = parseInt(j);
					}
				}
			}
		}
	}

	let res = {};
	for (let i in input_map) {
		if (input_map[i].node) {
			res[i] = input_map[i];
		}
	}

	return res;
}

function connect_inputs(nearest_inputs, node) {
	for(let i in nearest_inputs) {
		let info = nearest_inputs[i];
		info.node.connect(info.slot, node.id, info.input_name);
	}
}

function node_info_copy(src, dest, connect_both, copy_shape) {
	// copy input connections
	for(let i in src.inputs) {
		let input = src.inputs[i];
		if (input.widget !== undefined) {
			const destWidget = dest.widgets.find(x => x.name === input.widget.name);
			dest.convertWidgetToInput(destWidget);
		}
		if(input.link) {
			let link = app.graph.links[input.link];
			let src_node = app.graph.getNodeById(link.origin_id);
			src_node.connect(link.origin_slot, dest.id, input.name);
		}
	}

	// copy output connections
	if(connect_both) {
		let output_links = {};
		for(let i in src.outputs) {
			let output = src.outputs[i];
			if(output.links) {
				let links = [];
				for(let j in output.links) {
					links.push(app.graph.links[output.links[j]]);
				}
				output_links[output.name] = links;
			}
		}

		for(let i in dest.outputs) {
			let links = output_links[dest.outputs[i].name];
			if(links) {
				for(let j in links) {
					let link = links[j];
					let target_node = app.graph.getNodeById(link.target_id);
					dest.connect(parseInt(i), target_node, link.target_slot);
				}
			}
		}
	}

	if(copy_shape) {
		dest.color = src.color;
		dest.bgcolor = src.bgcolor;
		dest.size = max(src.size, dest.size);
	}

	app.graph.afterChange();
}

app.registerExtension({
	name: "Comfy.ConnectionHelper",

	async nodeCreated(node, app) {
		const onDrawForeground = node.onDrawForeground;
		const onMouseEnter = node.onMouseEnter;
		const onMouseLeave = node.onMouseLeave;
		const onMouseDown = node.onMouseDown;

		node.isFocused = false;
		node.onDrawForeground = function (...args) {
			onDrawForeground?.apply?.(this, args)

			if(this.isFocused && !node.flags.collapsed) {
				const ctx = args[0];
				ctx.save();
				ctx.font = "14px PrimeIcons";
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";

				ctx.fillStyle = "dodgerblue";
				ctx.beginPath();
				ctx.roundRect(node.width - 110, -LiteGraph.NODE_TITLE_HEIGHT + 5, 20, 20, 10);
				ctx.fill();

				ctx.fillStyle = "white";
				ctx.fillText("\u2190", node.width - 100, -LiteGraph.NODE_TITLE_HEIGHT + 14);

				ctx.fillStyle = "OrangeRed";
				ctx.beginPath();
				ctx.roundRect(node.width - 85, -LiteGraph.NODE_TITLE_HEIGHT + 5, 20, 20, 10);
				ctx.fill();

				if(node.inputs?.some(x => x.link != null) || node.outputs?.some(x => x.links != null && x.links.length > 0) ) {
					ctx.fillStyle = "Grey";
				}
				else{
					ctx.fillStyle = "Coral";
				}
				ctx.beginPath();
				ctx.roundRect(node.width - 60, -LiteGraph.NODE_TITLE_HEIGHT + 5, 20, 20, 10);
				ctx.fill();

				ctx.fillText("📋", node.width - 50, -LiteGraph.NODE_TITLE_HEIGHT + 13);

				// center icon
				ctx.font = "bold 10px PrimeIcons";
				ctx.fillStyle = "#228822";
				ctx.fillText("📋", node.width - 73, -LiteGraph.NODE_TITLE_HEIGHT + 15);
				ctx.font = "bold 12px PrimeIcons";
				ctx.fillText("\u2B05", node.width - 77, -LiteGraph.NODE_TITLE_HEIGHT + 12);

				ctx.restore();
			}
		}

		node.onMouseDown = function (...args) {
			onMouseDown?.apply?.(this, args);

			let pos = args[1];

			if((!node.inputs && !node.outputs)
					|| !(node.isFocused && !node.flags.collapsed)
					|| pos[1] > 0 // pos[1]>0 --> below title
					|| pos[0] < node.width - 110
					|| pos[0] > node.width - 40
					)
				return;

			let x = pos[0] - node.width;

			if(-110 <= x && x <= -90) {
				// possible-input
				let nearest_inputs = lookup_nearest_inputs(node);
				if(nearest_inputs)
					connect_inputs(nearest_inputs, node);
			}
			else if(-85 <= x && x <= -65) {
				let src_node = lookup_nearest_nodes(node);
				if(src_node)
				{
					node_info_copy(src_node, node, false, false);
				}
			}
			else if(-60 <= x && x <= -40) {
				let right_policy = "no-copy-shape";

				if(node.inputs?.some(x => x.link != null) || node.outputs?.some(x => x.links != null && x.links.length > 0) )
					return;

				let src_node = lookup_nearest_nodes(node);
				if(src_node)
				{
					let copy_shape = right_policy == "copy-shape";
					node_info_copy(src_node, node, true, copy_shape);
				}
			}
		}

		node.onMouseEnter = function(...args) {
			onMouseEnter?.apply?.(this, args);
			node.isFocused = true;
		}
		node.onMouseLeave = function(...args) {
			node.isFocused = false;
			onMouseLeave?.apply?.(this, args);
		}
	}
});
