import { Routes } from '@angular/router';
import { ListMathOpsComponent } from './list/list-math-ops.component';
import { AddMathOpsComponent } from './add/add-math-ops.component';
import { ViewMathOpsComponent } from './view/view-math-ops.component';

// What the host lazy-loads (manifest frontend.remote.exposedModule = './Extension').
//
// A `Routes` array, not an NgModule: Angular's `loadChildren` accepts either, and the host's
// extension-route-registrar resolves the export named `Extension` and hands it straight to loadChildren.
// The components are standalone and declare their own `imports`, so there is nothing left for a module
// to do. THE EXPORTED CONST MUST STILL BE NAMED `Extension`.
export const Extension: Routes = [
  { path: '', component: ListMathOpsComponent },
  { path: 'add', component: AddMathOpsComponent },
  { path: 'view/:id', component: ViewMathOpsComponent },
];
