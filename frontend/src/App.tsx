import { Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import ClerkAuthProvider from "@/components/auth/ClerkAuthProvider";
import AppShell from "@/components/layout/AppShell";
import Dashboard from "@/pages/Dashboard";
import ImportPage from "@/pages/Import";
import MatchReview from "@/pages/MatchReview";
import ExportPage from "@/pages/Export";
import AdminQueue from "@/pages/AdminQueue";
import UsersPage from "@/pages/Users";
import Gallery from "@/pages/Gallery";
import Links from "@/pages/Links";
import AuditPage from "@/pages/Audit";
import Worklist from "@/pages/Worklist";
import History from "@/pages/History";
import SharedWorklist from "@/pages/SharedWorklist";
import { SignInPage, SignUpPage } from "@/pages/Auth";

export default function App() {
  return (
    <ClerkAuthProvider>
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="/share/worklist" element={<SharedWorklist />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/review" element={<MatchReview />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/admin/queue" element={<AdminQueue />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/links" element={<Links />} />
          <Route path="/admin/audit" element={<AuditPage />} />
          <Route path="/worklist" element={<Worklist />} />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
      <Toaster richColors />
    </ClerkAuthProvider>
  );
}
