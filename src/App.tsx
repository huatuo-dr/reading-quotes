import { Route, Routes } from 'react-router-dom'
import AdminPage from './pages/AdminPage'
import HomePage from './pages/HomePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  )
}
