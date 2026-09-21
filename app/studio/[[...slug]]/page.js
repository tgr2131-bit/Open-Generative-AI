import StandaloneShell from '@/components/StandaloneShell';
import CustomUpstreamBanner from '@/components/CustomUpstreamBanner';

export const metadata = {
  title: 'Studio — Open Generative AI',
};

export default function StudioPage() {
  return (
    <>
      <StandaloneShell />
      <CustomUpstreamBanner />
    </>
  );
}
