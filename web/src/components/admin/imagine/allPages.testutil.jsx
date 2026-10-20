// Tests: every Image generation page at once, with one save bar, inside the
// provider, the same state the Settings pages share (P5-03).
import { ImagineSettingsProvider, ImagineSaveBar } from './ImagineSettings.jsx';
import OverviewPage from './OverviewPage.jsx';
import ComfyPage from './ComfyPage.jsx';
import QualityPage from './QualityPage.jsx';
import VariationsPage from './VariationsPage.jsx';
import KiePage from './KiePage.jsx';
import TryPage from './TryPage.jsx';

export default function ImagineAllPages(props) {
  return (
    <ImagineSettingsProvider {...props}>
      <OverviewPage />
      <ComfyPage />
      <QualityPage />
      <VariationsPage />
      <KiePage />
      <TryPage />
      <ImagineSaveBar />
    </ImagineSettingsProvider>
  );
}
