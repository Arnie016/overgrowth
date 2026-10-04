# Agent squad in real Minecraft

Five bots (Kit, Roan, Mira, Juno, Pax) join your Minecraft Java world. Type `!squad` in chat, and each one builds a TNT rig near you, sets it off with a redstone block, and checks the real world. Results go to chat. A bot that fails walks over to you.

| Bot | Test | Passes when |
|---|---|---|
| Kit | chain reaction | all 4 TNT in a row are gone |
| Roan | blast radius | planks at 2 blocks are destroyed and planks at 7 blocks survive |
| Mira | obsidian cover | planks behind an obsidian wall survive |
| Juno | TNT under water | stone next to an underwater blast survives |
| Pax | TNT vs zombie | a pinned zombie next to the TNT dies |

## Run it on your computer
1. **Get a server running.** Use a local Paper or vanilla server with `online-mode=false` in `server.properties`. Your `minecraft-server-studio` setup works. Alternatively, open a singleplayer world to LAN with cheats on and use the port it prints.
2. **Install Node 18+**, then in this folder run:
   ```bash
   npm i
   MC_HOST=localhost MC_PORT=25565 npm start
   ```
3. **Op the bots** from the server console: `op Kit`, `op Roan`, `op Mira`, `op Juno`, `op Pax`.
4. **Start the tests.** Stand somewhere flat and type `!squad`. Each bot clears its own pad about 12 blocks around you, so don't stand inside one.

Set `MC_VERSION` (for example `1.21.1`) if auto-detect fails.
