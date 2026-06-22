import { useAppSelector } from "@/app/hooks";
import {
  PhoneFrame, Chrome, TaskBar, TempBar, AgentBar, BottomNav, Toast,
} from "@/components/shell";
import { Overlays } from "@/overlays/Overlays";

import Home from "@/screens/Home";
import Windows from "@/screens/Windows";
import Scenes from "@/screens/Scenes";
import Editor from "@/screens/Editor";
import Modules from "@/screens/Modules";
import ModuleDetail from "@/screens/ModuleDetail";
import CreateModule from "@/screens/CreateModule";
import Workshop from "@/screens/Workshop";
import Profiles from "@/screens/Profiles";
import ProfileDetail from "@/screens/ProfileDetail";
import AddPhotos from "@/screens/AddPhotos";
import NewProfile from "@/screens/NewProfile";
import Settings from "@/screens/Settings";
import Radar from "@/screens/dev/Radar";
import Camera from "@/screens/dev/Camera";
import Comms from "@/screens/dev/Comms";

function Stage() {
  const screen = useAppSelector((s) => s.ui.screen);
  switch (screen) {
    case "home": return <Home />;
    case "windows": return <Windows />;
    case "scenes": return <Scenes />;
    case "editor": return <Editor />;
    case "modules": return <Modules />;
    case "moddetail": return <ModuleDetail />;
    case "create": return <CreateModule />;
    case "workshop": return <Workshop />;
    case "profiles": return <Profiles />;
    case "profile": return <ProfileDetail />;
    case "addphotos": return <AddPhotos />;
    case "newprofile": return <NewProfile />;
    case "settings": return <Settings />;
    case "radar": return <Radar />;
    case "camera": return <Camera />;
    case "comms": return <Comms />;
    default: return <Home />;
  }
}

export default function App() {
  return (
    <PhoneFrame>
      <Chrome />
      <TaskBar />
      <TempBar />
      <AgentBar />
      <div id="mc-stage" className="mc-noscroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
        <Stage />
      </div>
      <BottomNav />
      <Overlays />
      <Toast />
    </PhoneFrame>
  );
}
