import type {Component} from 'solid-js'

import logo from './logo.svg'
import styles from './App.module.css'
import * as Day1 from './components/Day1.jsx'

const App: Component = () => {
	return (
		<div class={styles.App}>
			<h1>Hello world from solidjs!</h1>
			<br />
			<Day1.Comp3 />
		</div>
	)
}
// <Day1.Comp1 />
// <Day1.Comp2 />

export default App
