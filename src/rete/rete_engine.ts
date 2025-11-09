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

    // 5. Center everything in view
    AreaExtensions.zoomAt(area, editor.getNodes())

    return { editor, area }
}

// Helper socket creator
function socket(name: string) {
    return new ClassicPreset.Socket(name)
}