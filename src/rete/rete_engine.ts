import { NodeEditor, ClassicPreset, GetSchemes } from 'rete'
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin'
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin'
import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin'

type Scheme = GetSchemes<ClassicPreset.Node, ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>>

export async function createEditor(container: HTMLElement) {
    const editor = new NodeEditor<Scheme>()

    const area = new AreaPlugin<Scheme, HTMLElement>(container)
    const connection = new ConnectionPlugin<Scheme>()
    const render = new ReactPlugin<Scheme, HTMLElement>()

    editor.use(area)
    editor.use(connection as any)
    editor.use(render as any)

    render.addPreset(ReactPresets.classic.setup() as any)
    connection.addPreset(ConnectionPresets.classic.setup() as any)

    // Test add node.
    const nodeA = new ClassicPreset.Node('Primitive')
    const nodeB = new ClassicPreset.Node('Output')

    const output = new ClassicPreset.Output(socket('Geometry'), 'Geometry')
    const input = new ClassicPreset.Input(socket('Geometry'), 'Geometry')

    nodeA.addOutput('out', output)
    nodeB.addInput('in', input)

    await editor.addNode(nodeA)
    await editor.addNode(nodeB)

    await editor.addConnection(new ClassicPreset.Connection(nodeA, 'out', nodeB, 'in'))

    // Center everything in view.
    AreaExtensions.zoomAt(area as any, editor.getNodes())
    return { editor, area }
}

// Helper socket creator
function socket(name: string) {
    return new ClassicPreset.Socket(name)
}