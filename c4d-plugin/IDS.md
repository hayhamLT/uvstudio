# Cinema 4D Plugin IDs

Reserved at [plugincafe.maxon.net](https://plugincafe.maxon.net) under the
account **hayhamLT**. These are globally unique — do not reuse placeholders.

| Use | ID | Notes |
|-----|------|-------|
| `PLUGIN_ID` | **1069117** | Plugin registration (label: `UVStudioBridge`, reserved 2026-06-30). |
| `GUID_KEY` | **1069117** | BaseContainer key that stamps each object's round-trip guid. Same number is safe — it lives in the object's data container, a different namespace from the plugin registry. |

If we ever store **more** per-object data (multiple container keys), reserve
additional IDs rather than inventing offsets. One value under the registered ID
is fine; several invented keys risk clobbering other plugins' data.

Both were placeholders before (`1066001` / `1062500`) — anything built before
2026-06-30 used those and should not be distributed.
